import express from "express";
import {
    signupBarber,
    loginBarber,
    createBarberSignupPaymentOrder,
    verifyBarberSignupPayment
} from "../controller/barber.controller.js";
import {
    getBarberDashboard,
    getBarberBookings,
    updateBookingStatus,
    getBarberServices,
    createService,
    updateService,
    deleteService,
    getTeamMembers,
    getBarberAnalytics,
    getStudioSettings,
    updateStudioSettings,
    createWalkInBooking,
    getBarberReviewsForDashboard,
    getBarberPayments,
    updatePaymentStatus
} from "../controller/barberDashboard.controller.js";
import { authenticateToken, requireBarber, requireStudioOwner, requireStudioAccess } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Legacy auth routes (kept for backward compatibility)
// Mounted under /api/studios/manage/*
// New apps should use /api/studios/auth/* instead
router.post("/signup/payment/order", createBarberSignupPaymentOrder);
router.post("/signup/payment/verify", verifyBarberSignupPayment);
router.post("/signup", signupBarber);
router.post("/login", loginBarber);

// Dashboard routes (accessible by studio owners and barbers)
router.get("/dashboard", authenticateToken, requireStudioAccess, getBarberDashboard);
router.get("/bookings", authenticateToken, requireStudioAccess, getBarberBookings);
router.patch("/bookings/:id/status", authenticateToken, requireStudioAccess, updateBookingStatus);

// Services management (studio owners have full CRUD, barbers can view)
router.get("/services", authenticateToken, requireStudioAccess, getBarberServices);
router.post("/services", authenticateToken, requireStudioAccess, createService);
router.put("/services/:id", authenticateToken, requireStudioAccess, updateService);
router.delete("/services/:id", authenticateToken, requireStudioAccess, deleteService);

// Team management (view team members)
router.get("/team", authenticateToken, requireStudioAccess, getTeamMembers);

// Analytics (accessible by studio owners and barbers)
router.get("/analytics", authenticateToken, requireStudioAccess, getBarberAnalytics);

// Studio settings (full access for owners, view-only for barbers)
router.get("/studio", authenticateToken, requireStudioAccess, getStudioSettings);
router.put("/studio", authenticateToken, requireStudioAccess, updateStudioSettings);

// Walk-in bookings
router.post("/walk-in", authenticateToken, requireStudioAccess, createWalkInBooking);

// Reviews
router.get("/reviews", authenticateToken, requireStudioAccess, getBarberReviewsForDashboard);

// Payments
router.get("/payments", authenticateToken, requireStudioAccess, getBarberPayments);
router.patch("/payments/:id", authenticateToken, requireStudioAccess, updatePaymentStatus);

export default router;
