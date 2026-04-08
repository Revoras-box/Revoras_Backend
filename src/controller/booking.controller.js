import pool from "../config/db.js";
import { isValidId, isFutureDate, sanitizeString } from "../utils/validation.js";

/**
 * Create a new booking
 * POST /api/bookings
 */
export const createBooking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      studioId, 
      barberId, 
      serviceIds, 
      appointmentDate, 
      appointmentTime,
      notes 
    } = req.body;

    // Validate required fields
    if (!studioId || !barberId || !serviceIds?.length || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ 
        error: "Studio, barber, services, date and time are required" 
      });
    }

    // Validate date is in the future
    const appointmentDateTime = new Date(`${appointmentDate}T${appointmentTime}`);
    if (appointmentDateTime <= new Date()) {
      return res.status(400).json({ error: "Appointment must be in the future" });
    }

    // Check barber availability
    const conflictCheck = await pool.query(
      `SELECT id FROM bookings 
       WHERE barber_id = $1 
       AND appointment_date = $2 
       AND appointment_time = $3 
       AND status NOT IN ('cancelled', 'completed')`,
      [barberId, appointmentDate, appointmentTime]
    );

    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({ error: "Time slot not available" });
    }

    // Calculate total price from services
    const servicesResult = await pool.query(
      `SELECT id, price, duration FROM services WHERE id = ANY($1)`,
      [serviceIds]
    );

    if (servicesResult.rows.length !== serviceIds.length) {
      return res.status(400).json({ error: "One or more services not found" });
    }

    const totalPrice = servicesResult.rows.reduce((sum, s) => sum + parseFloat(s.price), 0);
    const totalDuration = servicesResult.rows.reduce((sum, s) => sum + s.duration, 0);

    // Create booking
    const result = await pool.query(
      `INSERT INTO bookings 
       (user_id, studio_id, barber_id, appointment_date, appointment_time, 
        total_price, total_duration, notes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
       RETURNING *`,
      [
        userId, 
        studioId, 
        barberId, 
        appointmentDate, 
        appointmentTime, 
        totalPrice, 
        totalDuration,
        sanitizeString(notes || "")
      ]
    );

    const bookingId = result.rows[0].id;

    // Insert booking services
    for (const serviceId of serviceIds) {
      await pool.query(
        `INSERT INTO booking_services (booking_id, service_id) VALUES ($1, $2)`,
        [bookingId, serviceId]
      );
    }

    // Generate confirmation code
    const confirmationCode = `REV-${bookingId}-${Date.now().toString(36).toUpperCase()}`;
    await pool.query(
      `UPDATE bookings SET confirmation_code = $1 WHERE id = $2`,
      [confirmationCode, bookingId]
    );

    res.status(201).json({
      message: "Booking created successfully",
      booking: {
        ...result.rows[0],
        confirmationCode,
        services: servicesResult.rows
      }
    });
  } catch (error) {
    console.error("Create booking error:", error);
    res.status(500).json({ error: "Failed to create booking" });
  }
};

/**
 * Get user's bookings
 * GET /api/bookings
 */
export const getUserBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    let query = `
      SELECT 
        b.*,
        s.name as studio_name,
        s.address as studio_address,
        s.image_url as studio_image,
        br.name as barber_name,
        br.image_url as barber_image,
        json_agg(json_build_object(
          'id', sv.id,
          'name', sv.name,
          'price', sv.price
        )) as services
      FROM bookings b
      JOIN studios s ON b.studio_id = s.id
      JOIN barbers br ON b.barber_id = br.id
      LEFT JOIN booking_services bs ON b.id = bs.booking_id
      LEFT JOIN services sv ON bs.service_id = sv.id
      WHERE b.user_id = $1
    `;

    const params = [userId];

    if (status) {
      query += ` AND b.status = $${params.length + 1}`;
      params.push(status);
    }

    query += `
      GROUP BY b.id, s.id, br.id
      ORDER BY b.appointment_date DESC, b.appointment_time DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, (page - 1) * limit);

    const result = await pool.query(query, params);

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM bookings WHERE user_id = $1 ${status ? "AND status = $2" : ""}`,
      status ? [userId, status] : [userId]
    );

    res.json({
      bookings: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error("Get bookings error:", error);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

/**
 * Get single booking details
 * GET /api/bookings/:id
 */
export const getBookingById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        b.*,
        s.name as studio_name,
        s.address as studio_address,
        s.phone as studio_phone,
        s.image_url as studio_image,
        s.lat, s.lng,
        br.name as barber_name,
        br.image_url as barber_image,
        br.rating as barber_rating,
        json_agg(json_build_object(
          'id', sv.id,
          'name', sv.name,
          'price', sv.price,
          'duration', sv.duration
        )) as services
      FROM bookings b
      JOIN studios s ON b.studio_id = s.id
      JOIN barbers br ON b.barber_id = br.id
      LEFT JOIN booking_services bs ON b.id = bs.booking_id
      LEFT JOIN services sv ON bs.service_id = sv.id
      WHERE b.id = $1 AND b.user_id = $2
      GROUP BY b.id, s.id, br.id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json({ booking: result.rows[0] });
  } catch (error) {
    console.error("Get booking error:", error);
    res.status(500).json({ error: "Failed to fetch booking" });
  }
};

/**
 * Cancel booking
 * PATCH /api/bookings/:id/cancel
 */
export const cancelBooking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    // Check booking exists and belongs to user
    const booking = await pool.query(
      `SELECT * FROM bookings WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const bookingData = booking.rows[0];

    // Check if booking can be cancelled
    if (bookingData.status === "cancelled") {
      return res.status(400).json({ error: "Booking already cancelled" });
    }

    if (bookingData.status === "completed") {
      return res.status(400).json({ error: "Cannot cancel completed booking" });
    }

    // Check cancellation window (e.g., 2 hours before appointment)
    const appointmentTime = new Date(`${bookingData.appointment_date}T${bookingData.appointment_time}`);
    const hoursUntilAppointment = (appointmentTime - new Date()) / (1000 * 60 * 60);

    if (hoursUntilAppointment < 2) {
      return res.status(400).json({ 
        error: "Cannot cancel within 2 hours of appointment. Please contact support." 
      });
    }

    // Update booking status
    await pool.query(
      `UPDATE bookings 
       SET status = 'cancelled', 
           cancellation_reason = $1,
           cancelled_at = NOW()
       WHERE id = $2`,
      [sanitizeString(reason || "User cancelled"), id]
    );

    res.json({ message: "Booking cancelled successfully" });
  } catch (error) {
    console.error("Cancel booking error:", error);
    res.status(500).json({ error: "Failed to cancel booking" });
  }
};

/**
 * Reschedule booking
 * PATCH /api/bookings/:id/reschedule
 */
export const rescheduleBooking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { appointmentDate, appointmentTime } = req.body;

    if (!appointmentDate || !appointmentTime) {
      return res.status(400).json({ error: "New date and time required" });
    }

    // Check booking exists
    const booking = await pool.query(
      `SELECT * FROM bookings WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const bookingData = booking.rows[0];

    if (["cancelled", "completed"].includes(bookingData.status)) {
      return res.status(400).json({ error: "Cannot reschedule this booking" });
    }

    // Validate new date
    const newDateTime = new Date(`${appointmentDate}T${appointmentTime}`);
    if (newDateTime <= new Date()) {
      return res.status(400).json({ error: "New appointment must be in the future" });
    }

    // Check barber availability for new time
    const conflictCheck = await pool.query(
      `SELECT id FROM bookings 
       WHERE barber_id = $1 
       AND appointment_date = $2 
       AND appointment_time = $3 
       AND id != $4
       AND status NOT IN ('cancelled', 'completed')`,
      [bookingData.barber_id, appointmentDate, appointmentTime, id]
    );

    if (conflictCheck.rows.length > 0) {
      return res.status(409).json({ error: "New time slot not available" });
    }

    // Update booking
    await pool.query(
      `UPDATE bookings 
       SET appointment_date = $1, 
           appointment_time = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [appointmentDate, appointmentTime, id]
    );

    res.json({ message: "Booking rescheduled successfully" });
  } catch (error) {
    console.error("Reschedule booking error:", error);
    res.status(500).json({ error: "Failed to reschedule booking" });
  }
};

/**
 * Get available time slots
 * GET /api/bookings/availability
 */
export const getAvailability = async (req, res) => {
  try {
    const { barberId, studioId, date } = req.query;

    if (!barberId || !date) {
      return res.status(400).json({ error: "Barber ID and date required" });
    }

    // Get barber's working hours
    const barberHours = await pool.query(
      `SELECT working_hours FROM barbers WHERE id = $1`,
      [barberId]
    );

    // Default working hours
    const defaultSlots = [
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
      "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
      "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"
    ];

    // Get booked slots
    const bookedSlots = await pool.query(
      `SELECT appointment_time 
       FROM bookings 
       WHERE barber_id = $1 
       AND appointment_date = $2 
       AND status NOT IN ('cancelled')`,
      [barberId, date]
    );

    const bookedTimes = bookedSlots.rows.map(r => r.appointment_time.slice(0, 5));

    // Filter available slots
    const availableSlots = defaultSlots.filter(slot => !bookedTimes.includes(slot));

    // If date is today, filter out past times
    const today = new Date().toISOString().split("T")[0];
    if (date === today) {
      const currentHour = new Date().getHours();
      const currentMin = new Date().getMinutes();
      const currentTime = `${currentHour.toString().padStart(2, "0")}:${currentMin.toString().padStart(2, "0")}`;
      
      return res.json({
        date,
        barberId,
        slots: availableSlots.filter(slot => slot > currentTime)
      });
    }

    res.json({
      date,
      barberId,
      slots: availableSlots
    });
  } catch (error) {
    console.error("Get availability error:", error);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
};
