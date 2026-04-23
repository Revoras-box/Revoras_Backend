/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  STUDIO SETTINGS – BACKEND ROUTES                                       ║
 * ║  Mount all four routers in your main Express/Hono app:                  ║
 * ║                                                                          ║
 * ║    app.use("/api/studio", studioSettingsRouter);                         ║
 * ║    app.use("/api/studio", studioMediaRouter);                            ║
 * ║    app.use("/api/studio", studioHoursRouter);                            ║
 * ║    app.use("/api/studio", studioBarbersRouter);                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Auth middleware assumed:  requireStudioOwner(req, res, next)
 *   - attaches req.owner  = { id, studio_id, name, email, … }
 *   - verifies JWT from Authorization: Bearer <token>
 *
 * Storage helper assumed:   uploadToStorage(file) → Promise<{ url: string }>
 *   - wraps S3 / Cloudflare R2 / Supabase Storage, etc.
 *
 * DB helper assumed:        db  (knex / drizzle / pg pool – adapt as needed)
 */

import express from "express";
import multer from "multer";
import { z } from "zod";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Placeholder stubs (replace with your real implementations) ───────────────
const requireStudioOwner = (req, res, next) => next();           // ← your auth middleware
const uploadToStorage = async (file) => ({ url: "" });        // ← your storage helper
const db = null;                          // ← your DB instance

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(res, data = {}) { return res.json({ success: true, ...data }); }
function err(res, msg, code = 400) { return res.status(code).json({ error: msg }); }

function parseTime(t) {
  if (!t) return null;
  return /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? t : null;
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTER 1 – STUDIO SETTINGS  (GET + PUT /api/studio/settings)
// ═════════════════════════════════════════════════════════════════════════════

export const studioSettingsRouter = express.Router();
studioSettingsRouter.use(requireStudioOwner);

/**
 * GET /api/studio/settings
 * Returns the full settings payload used by the frontend.
 */
studioSettingsRouter.get("/settings", async (req, res) => {
  try {
    const ownerId = req.owner.id;
    const studioId = req.owner.studio_id;

    const [owner, studio, workingHours, barbers] = await Promise.all([
      db("studio_owners").where({ id: ownerId }).first(),
      studioId ? db("studios").where({ id: studioId }).first() : null,
      studioId ? db("studio_hours").where({ studio_id: studioId }).orderBy("day_of_week") : [],
      studioId ? db("studio_barbers").where({ studio_id: studioId }).orderBy("display_order") : [],
    ]);

    return ok(res, {
      barber: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        title: owner.title ?? null,
        image_url: owner.image_url ?? null,
        logo_url: owner.logo_url ?? null,
      },
      studio: studio ?? null,
      workingHours: workingHours ?? [],
      barbers: barbers ?? [],
    });
  } catch (e) {
    console.error("[GET /settings]", e);
    return err(res, "Failed to fetch settings", 500);
  }
});

const updateSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  address: z.string().min(1).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  logoUrl: z.string().url().optional().or(z.literal("")),
  bannerUrl: z.string().url().optional().or(z.literal("")),
  workingHours: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    openTime: z.string(),
    closeTime: z.string(),
    isClosed: z.boolean(),
  })).optional(),
});

/**
 * PUT /api/studio/settings
 * Updates studio profile + working hours atomically.
 */
studioSettingsRouter.put("/settings", async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  const { workingHours, zipCode, imageUrl, logoUrl, bannerUrl, ...studioFields } = parsed.data;
  const studioId = req.owner.studio_id;

  try {
    await db.transaction(async (trx) => {
      // ── Update studio ──────────────────────────────────────────────────────
      if (studioId) {
        await trx("studios").where({ id: studioId }).update({
          ...studioFields,
          zip_code: zipCode ?? undefined,
          image_url: imageUrl ?? undefined,
          logo_url: logoUrl ?? undefined,
          banner_url: bannerUrl ?? undefined,
          updated_at: new Date(),
        });
      }

      // ── Upsert working hours ───────────────────────────────────────────────
      if (workingHours?.length && studioId) {
        for (const h of workingHours) {
          await trx("studio_hours")
            .insert({
              studio_id: studioId,
              day_of_week: h.dayOfWeek,
              open_time: parseTime(h.openTime),
              close_time: parseTime(h.closeTime),
              is_closed: h.isClosed,
              updated_at: new Date(),
            })
            .onConflict(["studio_id", "day_of_week"])
            .merge();
        }
      }
    });

    return ok(res, { message: "Settings updated" });
  } catch (e) {
    console.error("[PUT /settings]", e);
    return err(res, "Failed to update settings", 500);
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// ROUTER 2 – MEDIA UPLOAD  (POST /api/studio/upload-image)
// ═════════════════════════════════════════════════════════════════════════════

export const studioMediaRouter = express.Router();
studioMediaRouter.use(requireStudioOwner);

/**
 * POST /api/studio/upload-image
 * Accepts multipart/form-data with field "file".
 * Returns { url } pointing to the hosted image.
 *
 * Usage from frontend:
 *   const fd = new FormData(); fd.append("file", file);
 *   const res = await fetch("/api/studio/upload-image", { method: "POST", body: fd });
 *   const { url } = await res.json();
 */
studioMediaRouter.post(
  "/upload-image",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) return err(res, "No file provided");

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(req.file.mimetype)) {
      return err(res, "Only JPG, PNG, WEBP or GIF images are accepted");
    }

    try {
      const { url } = await uploadToStorage(req.file);
      return ok(res, { url });
    } catch (e) {
      console.error("[POST /upload-image]", e);
      return err(res, "Upload failed", 500);
    }
  }
);

/**
 * PUT /api/studio/:studioId/banner
 * Directly set banner_url (e.g. from an external CDN URL).
 */
studioMediaRouter.put("/:studioId/banner", async (req, res) => {
  const { studioId } = req.params;
  const { bannerUrl } = req.body;

  if (!bannerUrl) return err(res, "bannerUrl is required");
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  try {
    await db("studios").where({ id: studioId }).update({ banner_url: bannerUrl, updated_at: new Date() });
    return ok(res, { message: "Banner updated" });
  } catch (e) {
    return err(res, "Failed to update banner", 500);
  }
});

/**
 * PUT /api/studio/:studioId/logo
 * Directly set logo_url.
 */
studioMediaRouter.put("/:studioId/logo", async (req, res) => {
  const { studioId } = req.params;
  const { logoUrl } = req.body;

  if (!logoUrl) return err(res, "logoUrl is required");
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  try {
    await db("studios").where({ id: studioId }).update({ logo_url: logoUrl, updated_at: new Date() });
    return ok(res, { message: "Logo updated" });
  } catch (e) {
    return err(res, "Failed to update logo", 500);
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// ROUTER 3 – WORKING HOURS  (/api/studio/:studioId/hours)
// ═════════════════════════════════════════════════════════════════════════════

export const studioHoursRouter = express.Router();
studioHoursRouter.use(requireStudioOwner);

/**
 * GET /api/studio/:studioId/hours
 */
studioHoursRouter.get("/:studioId/hours", async (req, res) => {
  const { studioId } = req.params;
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  try {
    const hours = await db("studio_hours")
      .where({ studio_id: studioId })
      .orderBy("day_of_week");
    return ok(res, { hours });
  } catch (e) {
    return err(res, "Failed to fetch hours", 500);
  }
});

const hoursSchema = z.object({
  hours: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    openTime: z.string(),
    closeTime: z.string(),
    isClosed: z.boolean(),
  })).length(7),
});

/**
 * PUT /api/studio/:studioId/hours
 * Replaces all 7 day-entries in a single transaction.
 */
studioHoursRouter.put("/:studioId/hours", async (req, res) => {
  const { studioId } = req.params;
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  const parsed = hoursSchema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  try {
    await db.transaction(async (trx) => {
      for (const h of parsed.data.hours) {
        await trx("studio_hours")
          .insert({
            studio_id: studioId,
            day_of_week: h.dayOfWeek,
            open_time: parseTime(h.openTime),
            close_time: parseTime(h.closeTime),
            is_closed: h.isClosed,
            updated_at: new Date(),
          })
          .onConflict(["studio_id", "day_of_week"])
          .merge();
      }
    });
    return ok(res, { message: "Hours updated" });
  } catch (e) {
    console.error("[PUT /hours]", e);
    return err(res, "Failed to update hours", 500);
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// ROUTER 4 – BARBERS  (/api/studio/:studioId/barbers)
// ═════════════════════════════════════════════════════════════════════════════

export const studioBarbersRouter = express.Router();
studioBarbersRouter.use(requireStudioOwner);

/**
 * GET /api/studio/:studioId/barbers
 * Returns all barbers for the studio (ordered by display_order).
 */
studioBarbersRouter.get("/:studioId/barbers", async (req, res) => {
  const { studioId } = req.params;
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  try {
    const barbers = await db("studio_barbers")
      .where({ studio_id: studioId })
      .orderBy("display_order");
    return ok(res, { barbers });
  } catch (e) {
    return err(res, "Failed to fetch barbers", 500);
  }
});

const barberSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional().default(""),
  bio: z.string().optional().default(""),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().default(""),
  image_url: z.string().url().optional().or(z.literal("")),
  specialties: z.array(z.string()).optional().default([]),
  is_active: z.boolean().default(true),
  display_order: z.number().int().min(0).default(0),
});

/**
 * POST /api/studio/:studioId/barbers
 * Adds a new barber to the team.
 */
studioBarbersRouter.post("/:studioId/barbers", async (req, res) => {
  const { studioId } = req.params;
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  const parsed = barberSchema.safeParse(req.body);
  if (!parsed.success) return err(res, parsed.error.message);

  try {
    const [barber] = await db("studio_barbers")
      .insert({
        ...parsed.data,
        studio_id: studioId,
        specialties: JSON.stringify(parsed.data.specialties),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    return ok(res, { barber });
  } catch (e) {
    console.error("[POST /barbers]", e);
    return err(res, "Failed to create barber", 500);
  }
});

/**
 * PUT /api/studio/:studioId/barbers
 * Bulk-replaces the entire barber list (used by the settings page Save).
 * Existing barbers are updated, missing ones deleted, new ones inserted.
 */
studioBarbersRouter.put("/:studioId/barbers", async (req, res) => {
  const { studioId } = req.params;
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  const parsed = z.object({
    barbers: z.array(barberSchema.extend({ id: z.string().uuid().optional() }))
  }).safeParse(req.body);

  if (!parsed.success) return err(res, parsed.error.message);

  try {
    await db.transaction(async (trx) => {
      const incoming = parsed.data.barbers;
      const incomingIds = incoming.filter(b => b.id).map(b => b.id);

      // Delete removed barbers
      await trx("studio_barbers")
        .where({ studio_id: studioId })
        .whereNotIn("id", incomingIds.length ? incomingIds : ["__none__"])
        .delete();

      // Upsert each
      for (let i = 0; i < incoming.length; i++) {
        const { id, ...fields } = incoming[i];
        const row = {
          ...fields,
          studio_id: studioId,
          display_order: i,
          specialties: JSON.stringify(fields.specialties ?? []),
          updated_at: new Date(),
        };

        if (id) {
          await trx("studio_barbers").where({ id, studio_id: studioId }).update(row);
        } else {
          await trx("studio_barbers").insert({ ...row, created_at: new Date() });
        }
      }
    });

    return ok(res, { message: "Barbers saved" });
  } catch (e) {
    console.error("[PUT /barbers]", e);
    return err(res, "Failed to save barbers", 500);
  }
});

/**
 * PATCH /api/studio/:studioId/barbers/:barberId
 * Partial update for a single barber (e.g. toggle is_active, change photo).
 */
studioBarbersRouter.patch("/:studioId/barbers/:barberId", async (req, res) => {
  const { studioId, barberId } = req.params;
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  const partial = barberSchema.partial().safeParse(req.body);
  if (!partial.success) return err(res, partial.error.message);

  try {
    const updates = { ...partial.data, updated_at: new Date() };
    if (updates.specialties) updates.specialties = JSON.stringify(updates.specialties);

    const [barber] = await db("studio_barbers")
      .where({ id: barberId, studio_id: studioId })
      .update(updates)
      .returning("*");

    if (!barber) return err(res, "Barber not found", 404);
    return ok(res, { barber });
  } catch (e) {
    return err(res, "Failed to update barber", 500);
  }
});

/**
 * DELETE /api/studio/:studioId/barbers/:barberId
 * Permanently removes a barber.
 */
studioBarbersRouter.delete("/:studioId/barbers/:barberId", async (req, res) => {
  const { studioId, barberId } = req.params;
  if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);

  try {
    const deleted = await db("studio_barbers")
      .where({ id: barberId, studio_id: studioId })
      .delete();

    if (!deleted) return err(res, "Barber not found", 404);
    return ok(res, { message: "Barber deleted" });
  } catch (e) {
    return err(res, "Failed to delete barber", 500);
  }
});

/**
 * POST /api/studio/:studioId/barbers/:barberId/photo
 * Upload a new photo for a specific barber.
 */
studioBarbersRouter.post(
  "/:studioId/barbers/:barberId/photo",
  upload.single("file"),
  async (req, res) => {
    const { studioId, barberId } = req.params;
    if (req.owner.studio_id !== studioId) return err(res, "Forbidden", 403);
    if (!req.file) return err(res, "No file provided");

    try {
      const { url } = await uploadToStorage(req.file);
      await db("studio_barbers")
        .where({ id: barberId, studio_id: studioId })
        .update({ image_url: url, updated_at: new Date() });

      return ok(res, { url });
    } catch (e) {
      return err(res, "Upload failed", 500);
    }
  }
);


// ─── Migration snippet ────────────────────────────────────────────────────────
/**
 * Run this migration to add the studio_barbers table.
 *
 * exports.up = async (knex) => {
 *   await knex.schema.createTable("studio_barbers", (t) => {
 *     t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
 *     t.uuid("studio_id").notNullable().references("studios.id").onDelete("CASCADE");
 *     t.string("name").notNullable();
 *     t.string("title").defaultTo("");
 *     t.text("bio").defaultTo("");
 *     t.string("email").defaultTo("");
 *     t.string("phone").defaultTo("");
 *     t.string("image_url").defaultTo("");
 *     t.jsonb("specialties").defaultTo("[]");
 *     t.boolean("is_active").defaultTo(true);
 *     t.integer("display_order").defaultTo(0);
 *     t.timestamps(true, true);
 *   });
 * };
 */

export default router;
