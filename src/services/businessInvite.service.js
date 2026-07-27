import bcrypt from "bcrypt";
import crypto from "crypto";
import knex from "../../db/knex.js";
import * as inviteRepo from "../repositories/businessInvite.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as userRepo from "../repositories/user.repository.js";
import { sendEmail } from "./email.service.js";
import { ServiceError } from "../utils/ServiceError.js";
import { BCRYPT_ROUNDS } from "../config/hashing.js";

const INVITE_TTL_DAYS = 14;
const TOKEN_BYTES = 32;
const PG_UNIQUE_VIOLATION = "23505";

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const inviteUrl = (token) => `${process.env.FRONTEND_URL}/join?token=${token}`;
const expiryDate = () => new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

const mintToken = () => {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  return { token, tokenHash: hashToken(token) };
};

/** The insert/update `returning("*")` includes token_hash; it must never leave the service. */
const sanitize = ({ token_hash, ...rest }) => rest;

/**
 * The invite email is a convenience, not the mechanism. Delivery failure is
 * reported to the owner but does not fail the invite: the link they can copy
 * and send over WhatsApp is already valid, and that is how most of these will
 * actually reach people.
 */
const deliverInvite = async ({ invite, businessName, token }) => {
  if (!invite.email) return { emailed: false, reason: "no_email" };

  const result = await sendEmail({
    to: invite.email,
    subject: `${businessName} has invited you to join them on Revoras`,
    html: `
      <p>Hi ${invite.name},</p>
      <p><strong>${businessName}</strong> has invited you to join their team on Revoras${
        invite.designation ? ` as ${invite.designation}` : ""
      }.</p>
      <p><a href="${inviteUrl(token)}">Accept the invitation</a></p>
      <p>This link expires in ${INVITE_TTL_DAYS} days. If you weren't expecting this, you can ignore this email.</p>
    `,
  });

  return { emailed: result.success, reason: result.success ? null : result.error };
};

export const listInvites = (studioId) => inviteRepo.listPending(studioId);

export const createInvite = async (studioId, input, invitedByUserId) => {
  if (!input.email && !input.phone) {
    throw new ServiceError(400, "Add an email or a phone number so they can be reached");
  }

  const role = await businessRepo.findRoleByKey(input.roleKey);
  if (!role) throw new ServiceError(400, "Invalid role");

  const business = await businessRepo.findById(studioId);
  if (!business) throw new ServiceError(404, "Business not found");

  // Someone who already has an account and is already on the team should be
  // told that, rather than being sent a link that fails at the last step.
  if (input.email) {
    const existingUser = await userRepo.findByEmail(input.email);
    if (existingUser) {
      const existingMember = await businessMemberRepo.findByStudioAndUser(studioId, existingUser.id);
      if (existingMember) throw new ServiceError(409, "This person is already a member of this business");
    }
  }

  const { token, tokenHash } = mintToken();

  let invite;
  try {
    invite = await inviteRepo.create({
      studio_id: studioId,
      role_id: role.id,
      invited_by: invitedByUserId ?? null,
      name: input.name,
      email: input.email ? input.email.trim().toLowerCase() : null,
      phone: input.phone || null,
      designation: input.designation || null,
      provides_services: input.providesServices ?? true,
      experience_years: input.experienceYears || 0,
      token_hash: tokenHash,
      expires_at: expiryDate(),
    });
  } catch (err) {
    // From the partial unique indexes: one live invite per person per business.
    if (err.code === PG_UNIQUE_VIOLATION) {
      throw new ServiceError(409, "There's already a pending invite for this person. Resend or revoke it instead.");
    }
    throw err;
  }

  const delivery = await deliverInvite({ invite, businessName: business.name, token });

  // The raw token is returned exactly once, here, so the owner can copy the
  // link. It is not recoverable later - only its hash is stored.
  return { ...sanitize(invite), role_key: input.roleKey, invite_url: inviteUrl(token), ...delivery };
};

export const resendInvite = async (studioId, inviteId) => {
  const invite = await inviteRepo.findById(inviteId, studioId);
  if (!invite) throw new ServiceError(404, "Invite not found");
  if (invite.accepted_at) throw new ServiceError(409, "This invite has already been accepted");
  if (invite.revoked_at) throw new ServiceError(409, "This invite was revoked");

  const business = await businessRepo.findById(studioId);
  // Rotating rather than issuing a second token keeps "one live link per
  // invite" true; an older link someone already has stops working.
  const { token, tokenHash } = mintToken();
  const updated = await inviteRepo.rotateToken(inviteId, tokenHash, expiryDate());

  const delivery = await deliverInvite({ invite: updated, businessName: business.name, token });
  return { ...sanitize(updated), invite_url: inviteUrl(token), ...delivery };
};

export const revokeInvite = async (studioId, inviteId) => {
  const revoked = await inviteRepo.revoke(inviteId, studioId);
  if (!revoked) throw new ServiceError(404, "No pending invite to revoke");
  return sanitize(revoked);
};

/**
 * Unauthenticated - the invitee has no account yet. Returns only what the
 * accept screen needs to show; notably not the email or phone, so a guessed
 * token cannot be used to harvest contact details.
 */
export const previewInvite = async (token) => {
  const invite = await inviteRepo.findPendingByHash(hashToken(token));
  if (!invite) throw new ServiceError(404, "This invite link is invalid, expired, or already used");

  return {
    name: invite.name,
    designation: invite.designation,
    roleKey: invite.role_key,
    businessName: invite.business_name,
    businessLogoUrl: invite.business_logo_url,
    businessCity: invite.business_city,
    // Drives the accept screen: an existing account signs in, a new one sets a password.
    hasAccount: invite.email ? !!(await userRepo.findByEmail(invite.email)) : false,
    // Phone-only invites carry no email of their own - the accept screen must
    // collect one, since every user account requires one (users.email is NOT NULL).
    needsEmail: !invite.email,
  };
};

/**
 * Accepting is what creates the membership. Runs in one transaction: a failure
 * partway through must not leave a user account created against a consumed
 * invite, which would strand the person with no way back in.
 */
export const acceptInvite = async (token, { password, email }) => {
  const invite = await inviteRepo.findPendingByHash(hashToken(token));
  if (!invite) throw new ServiceError(404, "This invite link is invalid, expired, or already used");

  // The invite's own email, if it has one, is authoritative - the invitee
  // can't override it by typing a different address in the accept form.
  const accountEmail = invite.email || email;

  return knex.transaction(async (trx) => {
    let user = accountEmail ? await userRepo.findByEmail(accountEmail, trx) : null;

    if (!user) {
      if (!password || password.length < 8) {
        throw new ServiceError(400, "Choose a password of at least 8 characters");
      }
      if (!accountEmail) {
        throw new ServiceError(400, "An email address is required to create your account");
      }
      try {
        user = await userRepo.create(
          {
            name: invite.name,
            email: accountEmail,
            phone: invite.phone || null,
            password: await bcrypt.hash(password, BCRYPT_ROUNDS),
            // Only proven when the invite itself carried this address - the link
            // reaching them is what proves it, the same reasoning password reset
            // relies on. An address typed into the accept form is unverified.
            email_verified: !!invite.email,
          },
          trx
        );
      } catch (err) {
        // Only reachable for a self-typed email (phone-only invites): the
        // invite's own email was already confirmed free of an account above.
        if (err.code === PG_UNIQUE_VIOLATION) {
          throw new ServiceError(409, "An account with this email already exists - sign in instead");
        }
        throw err;
      }
    }

    try {
      await businessMemberRepo.create(
        {
          studio_id: invite.studio_id,
          user_id: user.id,
          role_id: invite.role_id,
          designation: invite.designation,
          provides_services: invite.provides_services,
          specialties: JSON.stringify([]),
          experience_years: invite.experience_years,
          status: "active",
        },
        trx
      );
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) {
        throw new ServiceError(409, "You're already a member of this business - just sign in");
      }
      throw err;
    }

    await inviteRepo.markAccepted(invite.id, user.id, trx);
    return { userId: user.id, studioId: invite.studio_id, businessName: invite.business_name };
  });
};
