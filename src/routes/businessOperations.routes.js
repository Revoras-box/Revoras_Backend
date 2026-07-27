import express from "express";
import { getWorkingHours, replaceWorkingHours } from "../controllers/workingHours.controller.js";
import { listTimeOff, createTimeOff, deleteTimeOff } from "../controllers/timeOff.controller.js";
import {
  getMemberWorkingHours,
  replaceMemberWorkingHours,
  getTeamAvailability,
} from "../controllers/memberWorkingHours.controller.js";
import {
  getBusinessById,
  updateBusiness,
  deactivateBusiness,
  uploadBusinessLogo,
} from "../controllers/business.controller.js";
import {
  listGallery,
  addGalleryImage,
  removeGalleryImage,
  reorderGallery,
  setCoverImage,
} from "../controllers/businessGallery.controller.js";
import {
  listMembers,
  getMember,
  addMember,
  updateMember,
  removeMember,
} from "../controllers/businessMember.controller.js";
import {
  listInvites,
  createInvite,
  resendInvite,
  revokeInvite,
} from "../controllers/businessInvite.controller.js";
import {
  listPortfolio,
  addPortfolioImage,
  removePortfolioImage,
  reorderPortfolio,
  setCoverImage as setPortfolioCover,
  updatePortfolioCaption,
} from "../controllers/portfolio.controller.js";
import {
  listCertificates,
  addCertificate,
  updateCertificate,
  removeCertificate,
} from "../controllers/certificate.controller.js";
import {
  listServices,
  getService,
  createService,
  updateService,
  deactivateService,
  uploadServiceImage,
} from "../controllers/service.controller.js";
import {
  listOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
} from "../controllers/offer.controller.js";
import { getDashboard } from "../controllers/dashboard.controller.js";
import { getAnalytics } from "../controllers/analytics.controller.js";
import {
  listBusinessBookings,
  rescheduleBusinessBooking,
  updateBusinessBookingStatus,
} from "../controllers/booking.controller.js";
import {
  getVerificationCenter,
  getEligibility,
  createRequest as createVerificationRequest,
  addDocument as addVerificationDocument,
  removeDocument as removeVerificationDocument,
  submitRequest as submitVerificationRequest,
} from "../controllers/businessVerification.controller.js";
import { getOnboarding, saveOnboardingStep, submitOnboarding } from "../controllers/onboarding.controller.js";
import {
  listDocuments as listBusinessDocuments,
  addDocument as addBusinessDocument,
  removeDocument as removeBusinessDocument,
} from "../controllers/businessDocument.controller.js";
import {
  getSubscription,
  createSubscriptionOrder,
  verifySubscriptionPayment,
  activateSubscriptionFree,
} from "../controllers/businessSubscription.controller.js";
import { replyToReview, deleteReviewReply } from "../controllers/review.controller.js";
import { listCustomers, getCustomerBookingHistory } from "../controllers/customer.controller.js";
import { listBusinessPayments } from "../controllers/businessPayment.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { requireBusinessMember } from "../middlewares/businessMember.middleware.js";
import { requirePermission } from "../middlewares/requirePermission.middleware.js";
import { apiLimiter, floodLimiter } from "../middlewares/rateLimit.middleware.js";
import { uploadSingle } from "../middlewares/upload.middleware.js";

/**
 * All /api/business/:studioId/* routes live in this one router (mergeParams
 * so :studioId from the mount path in server.js is visible here).
 *
 * Phase 2.3 (report.md Phase 2 plan) replaces the Phase 2.1 placeholder
 * authenticateBusinessMember (one call that both verified the JWT and
 * treated every active member as authorized for everything, no permission
 * check at all) with a real three-stage pipeline applied per route:
 * authenticate -> requireBusinessMember -> requirePermission(key). Read
 * endpoints only need membership (any active owner or staff can view);
 * mutations require the specific DB-driven permission key a real business
 * would want to hand out separately (a staff member can be trusted with
 * services.manage without also getting team.manage or settings.manage).
 * Time-off keeps its existing staff-scoped-to-own-time logic in the
 * controller rather than a permission key - a staff member managing their
 * own blocked time isn't a privilege escalation question.
 */
const router = express.Router({ mergeParams: true });

// floodLimiter (per-IP, generous) fronts the JWT verify; apiLimiter runs AFTER
// authenticate so the real budget is counted per staff member. With apiLimiter
// first, req.user didn't exist yet and the whole dashboard was billed to one
// per-IP bucket - i.e. every staff member in a salon shared 100 req/min.
router.use(floodLimiter, authenticate, apiLimiter, requireBusinessMember);

router.get("/", getBusinessById);
router.patch("/", requirePermission("settings.manage"), updateBusiness);
router.delete("/", requirePermission("settings.manage"), deactivateBusiness);

// Phase 0.1 (report.md plan): first endpoint wired through MediaService ->
// StorageProvider (Cloudflare R2). Multipart-parsed into memory by
// uploadSingle, never written to this server's disk.
router.post(
  "/logo",
  requirePermission("settings.manage"),
  uploadSingle("file"),
  uploadBusinessLogo
);

// Phase 1.1 (report.md V4 roadmap): business gallery, second real
// MediaService caller after the logo. Read is member-only here (any active
// owner/staff) - the public-facing view lives on the discovery endpoint
// instead (discovery.service.js's getBusiness), which reuses the same
// repository.
router.get("/gallery", listGallery);
router.post("/gallery", requirePermission("settings.manage"), uploadSingle("file"), addGalleryImage);
router.patch("/gallery/reorder", requirePermission("settings.manage"), reorderGallery);
router.patch("/gallery/:imageId/cover", requirePermission("settings.manage"), setCoverImage);
router.delete("/gallery/:imageId", requirePermission("settings.manage"), removeGalleryImage);

// Business documents (PAN/GST/other) - a compulsory onboarding upload straight
// to R2 via MediaService. Distinct from the eligibility-gated verification flow.
router.get("/documents", listBusinessDocuments);
router.post("/documents", requirePermission("settings.manage"), uploadSingle("file"), addBusinessDocument);
router.delete("/documents/:documentId", requirePermission("settings.manage"), removeBusinessDocument);

router.get("/members", listMembers);
router.get("/members/:memberId", getMember);
router.post("/members", requirePermission("team.manage"), addMember);
router.patch("/members/:memberId", requirePermission("team.manage"), updateMember);
router.delete("/members/:memberId", requirePermission("team.manage"), removeMember);

// Invites are how a professional who has no Revoras account yet joins the team;
// addMember above still handles the case where they already have one. Same
// team.manage key - inviting someone is adding someone, just deferred.
router.get("/invites", requirePermission("team.manage"), listInvites);
router.post("/invites", requirePermission("team.manage"), createInvite);
router.post("/invites/:inviteId/resend", requirePermission("team.manage"), resendInvite);
router.delete("/invites/:inviteId", requirePermission("team.manage"), revokeInvite);

// Phase 1.3b - Professional portfolio & certificate media. Read is member-only
// (any active owner/staff); the public-facing view is on the discovery endpoint.
// Mutations require team.manage (same key that governs member profiles). reorder
// is registered before :imageId so the static path wins.
router.get("/members/:memberId/portfolio", listPortfolio);
router.post("/members/:memberId/portfolio", requirePermission("team.manage"), uploadSingle("file"), addPortfolioImage);
router.patch("/members/:memberId/portfolio/reorder", requirePermission("team.manage"), reorderPortfolio);
router.patch("/members/:memberId/portfolio/:imageId/cover", requirePermission("team.manage"), setPortfolioCover);
router.patch("/members/:memberId/portfolio/:imageId", requirePermission("team.manage"), updatePortfolioCaption);
router.delete("/members/:memberId/portfolio/:imageId", requirePermission("team.manage"), removePortfolioImage);

router.get("/members/:memberId/certificates", listCertificates);
router.post("/members/:memberId/certificates", requirePermission("team.manage"), uploadSingle("file"), addCertificate);
router.patch("/members/:memberId/certificates/:certId", requirePermission("team.manage"), uploadSingle("file"), updateCertificate);
router.delete("/members/:memberId/certificates/:certId", requirePermission("team.manage"), removeCertificate);

router.get("/services", listServices);
// Static /services/image is registered before /services/:serviceId so the
// upload path is never captured as a serviceId. Returns { url } for the form
// to send back as imageUrl on create/update.
router.post("/services/image", requirePermission("services.manage"), uploadSingle("file"), uploadServiceImage);
router.get("/services/:serviceId", getService);
router.post("/services", requirePermission("services.manage"), createService);
router.patch("/services/:serviceId", requirePermission("services.manage"), updateService);
router.delete("/services/:serviceId", requirePermission("services.manage"), deactivateService);

// Phase 2.4 (Offers & Promotions). Reads are member-only (any active
// owner/staff can see the business's offers); mutations require offers.manage
// (decision D4 - a dedicated permission, since offers set real pricing and are
// separately delegable from the service catalog). Owner has it; staff does not.
router.get("/offers", listOffers);
router.get("/offers/:offerId", getOffer);
router.post("/offers", requirePermission("offers.manage"), createOffer);
router.patch("/offers/:offerId", requirePermission("offers.manage"), updateOffer);
router.delete("/offers/:offerId", requirePermission("offers.manage"), deleteOffer);

// Phase 1.4b - Verification Center. Reads are member-only (any active
// owner/staff); mutations require settings.manage (verification is an
// account-level trust action, same tier as business settings). Static
// sub-paths (/eligibility) are registered before the :requestId routes so
// they win. Document upload flows through MediaService like gallery/logo.
router.get("/verification", getVerificationCenter);
router.get("/verification/eligibility", getEligibility);
router.post("/verification", requirePermission("settings.manage"), createVerificationRequest);
router.post(
  "/verification/:requestId/documents",
  requirePermission("settings.manage"),
  uploadSingle("file"),
  addVerificationDocument
);
router.delete("/verification/:requestId/documents/:documentId", requirePermission("settings.manage"), removeVerificationDocument);
router.post("/verification/:requestId/submit", requirePermission("settings.manage"), submitVerificationRequest);

// Phase 1.5a - onboarding wizard state/save/submit. Read member-only; writes
// require settings.manage (owner-level). Field saves reuse business.service's
// updateBusiness; status changes go through BusinessLifecycleService.
router.get("/onboarding", getOnboarding);
router.patch("/onboarding", requirePermission("settings.manage"), saveOnboardingStep);
router.post("/onboarding/submit", requirePermission("settings.manage"), submitOnboarding);

// Phase 1.5d - ₹99/month subscription. Read member-only; writes require
// settings.manage (owner-level, same tier as onboarding). The Razorpay webhook
// itself stays at the existing top-level /api/payments/webhook (HMAC-verified,
// not JWT-authenticated) - payment.service.js dispatches to
// businessSubscription.service.js there once it resolves a 'subscription' payment row.
router.get("/subscription", getSubscription);
router.post("/subscription/order", requirePermission("settings.manage"), createSubscriptionOrder);
router.post("/subscription/verify", requirePermission("settings.manage"), verifySubscriptionPayment);
// TEMPORARY: activate without a payment while no gateway is live (self-disables
// once Razorpay is configured - see businessSubscription.service.js).
router.post("/subscription/activate-free", requirePermission("settings.manage"), activateSubscriptionFree);

router.get("/dashboard", getDashboard);
router.get("/analytics", requirePermission("analytics.view"), getAnalytics);

router.get("/bookings", listBusinessBookings);
router.patch("/bookings/:id", requirePermission("bookings.manage"), rescheduleBusinessBooking);
router.patch("/bookings/:id/status", requirePermission("bookings.manage"), updateBusinessBookingStatus);

// Reviews are READ through the public /api/reviews/business/:studioId endpoint.
// Only the business's own reply is written here, where the studio scope and the
// reviews.respond permission apply. PUT, not POST: replying twice is an edit.
router.put("/reviews/:reviewId/reply", requirePermission("reviews.respond"), replyToReview);
router.delete("/reviews/:reviewId/reply", requirePermission("reviews.respond"), deleteReviewReply);

router.get("/customers", listCustomers);
router.get("/customers/:userId/bookings", getCustomerBookingHistory);

router.get("/payments", requirePermission("payments.view"), listBusinessPayments);

router.get("/working-hours", getWorkingHours);
router.put("/working-hours", requirePermission("settings.manage"), replaceWorkingHours);

// Per-professional rotas. Behind team.manage rather than settings.manage: this
// is "when does Ravi work", which belongs with managing the team, not with the
// shop's own opening hours above.
router.get("/members/:memberId/working-hours", getMemberWorkingHours);
router.put("/members/:memberId/working-hours", requirePermission("team.manage"), replaceMemberWorkingHours);

// Read-only view of the whole team's free slots on a date - membership is
// enough, since anyone who can see the calendar can already see this.
router.get("/availability", getTeamAvailability);

router.get("/time-off", listTimeOff);
router.post("/time-off", createTimeOff);
router.delete("/time-off/:id", deleteTimeOff);

export default router;
