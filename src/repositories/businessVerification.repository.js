import knex from "../../db/knex.js";

/**
 * Phase 1.4b - data access for the four verification tables. Names are
 * `businessVerification*` throughout to keep this distinct from
 * verification.repository.js (the signup OTP flow).
 */

const REQUEST_FIELDS = [
  "id",
  "business_id",
  "status",
  "eligibility_snapshot",
  "applicant_note",
  "decision_reason",
  "reviewed_by",
  "submitted_at",
  "reviewed_at",
  "created_at",
  "updated_at",
];

const OPEN_STATUSES = ["draft", "submitted", "under_review", "more_info"];

// ---- verification_requests ----

export const findOpenRequest = (businessId, db = knex) =>
  db("verification_requests").where({ business_id: businessId }).whereIn("status", OPEN_STATUSES).first(REQUEST_FIELDS);

// Most recent request of any status - what the Verification Center shows.
export const findLatestRequest = (businessId, db = knex) =>
  db("verification_requests").where({ business_id: businessId }).orderBy("created_at", "desc").first(REQUEST_FIELDS);

export const findRequestById = (id, db = knex) =>
  db("verification_requests").where({ id }).first(REQUEST_FIELDS);

// Scoped read so a business can only ever touch its own request.
export const findRequestForBusiness = (id, businessId, db = knex) =>
  db("verification_requests").where({ id, business_id: businessId }).first(REQUEST_FIELDS);

export const createRequest = (row, db = knex) =>
  db("verification_requests").insert(row).returning(REQUEST_FIELDS).then((rows) => rows[0]);

export const updateRequest = (id, patch, db = knex) =>
  db("verification_requests")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(REQUEST_FIELDS)
    .then((rows) => rows[0]);

// ---- admin queue ----

export const listQueue = async ({ status, page = 1, limit = 20 }, db = knex) => {
  const base = db("verification_requests as vr")
    .join("businesses as b", "b.id", "vr.business_id")
    .modify((q) => {
      if (status) q.where("vr.status", status);
    });

  const [{ total }] = await base.clone().count("* as total");
  const rows = await base
    .clone()
    .select(
      "vr.id",
      "vr.business_id",
      "vr.status",
      "vr.submitted_at",
      "vr.reviewed_at",
      "vr.created_at",
      "b.name as business_name",
      "b.city as business_city",
      "b.approval_status as business_approval_status"
    )
    // submitted first (nulls last), then oldest-submitted first - a FIFO queue.
    .orderByRaw("vr.submitted_at asc nulls last")
    .limit(limit)
    .offset((page - 1) * limit);

  return { rows, total: Number(total) };
};

export const countByStatus = (db = knex) =>
  db("verification_requests").select("status").count("* as count").groupBy("status");

// ---- verification_documents ----

const DOCUMENT_FIELDS = ["id", "request_id", "business_id", "type", "url", "original_name", "status", "review_note", "created_at"];

export const listDocuments = (requestId, db = knex) =>
  db("verification_documents").where({ request_id: requestId }).select(DOCUMENT_FIELDS).orderBy("created_at", "asc");

export const countDocuments = (requestId, db = knex) =>
  db("verification_documents").where({ request_id: requestId }).count("* as c").first().then((r) => Number(r.c));

export const findDocument = (id, requestId, db = knex) =>
  db("verification_documents").where({ id, request_id: requestId }).first(DOCUMENT_FIELDS);

export const createDocument = (row, db = knex) =>
  db("verification_documents").insert(row).returning(DOCUMENT_FIELDS).then((rows) => rows[0]);

export const updateDocument = (id, patch, db = knex) =>
  db("verification_documents").where({ id }).update(patch).returning(DOCUMENT_FIELDS).then((rows) => rows[0]);

export const removeDocument = (id, requestId, db = knex) =>
  db("verification_documents").where({ id, request_id: requestId }).del();

// ---- verification_history (append-only) ----

export const addHistory = (row, db = knex) => db("verification_history").insert(row);

export const listHistory = (requestId, db = knex) =>
  db("verification_history")
    .where({ request_id: requestId })
    .select("id", "from_status", "to_status", "actor_type", "actor_id", "note", "created_at")
    .orderBy("created_at", "asc");

// ---- verification_notes (admin-internal, never public) ----

export const addNote = (row, db = knex) =>
  db("verification_notes")
    .insert(row)
    .returning(["id", "request_id", "admin_id", "note", "created_at"])
    .then((rows) => rows[0]);

export const listNotes = (requestId, db = knex) =>
  db("verification_notes")
    .leftJoin("admins", "admins.id", "verification_notes.admin_id")
    .where({ request_id: requestId })
    .select(
      "verification_notes.id",
      "verification_notes.note",
      "verification_notes.created_at",
      "verification_notes.admin_id",
      "admins.name as admin_name"
    )
    .orderBy("verification_notes.created_at", "asc");

export const runInTransaction = (work) => knex.transaction(work);
