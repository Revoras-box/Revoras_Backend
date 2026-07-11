import pool from "../config/db.js";
import { isValidId, isFutureDate, sanitizeString } from "../utils/validation.js";
import { tableHasIntegerId } from "../utils/dbSchema.js";

const addMinutesToTime = (timeValue, minutesToAdd) => {
  const [hourRaw = "0", minuteRaw = "0"] = String(timeValue).split(":");
  const totalMinutes = Number(hourRaw) * 60 + Number(minuteRaw) + Number(minutesToAdd || 0);
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
};

// Converts a "HH:MM" or "HH:MM:SS" string to minutes since midnight
const timeToMinutes = (timeValue) => {
  if (!timeValue) return null;
  const [hourRaw, minuteRaw] = String(timeValue).split(":");
  const hours = Number(hourRaw);
  const minutes = Number(minuteRaw);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

// Half-open interval overlap: [startA, endA) intersects [startB, endB)
const rangesOverlap = (startA, endA, startB, endB) =>
  startA < endB && startB < endA;

/**
 * Checks whether a barber has a conflicting booking or blocked-time entry
 * for the half-open interval [startTime, endTime) on the given date.
 * `db` may be the pool or a transaction client - both expose `.query`.
 * `excludeBookingId` lets reschedule ignore the booking being moved.
 */
const findBarberConflict = async (db, { barberId, date, startTime, endTime, excludeBookingId }) => {
  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);

  const bookingParams = [barberId, date];
  let bookingQuery = `
    SELECT id, start_time, end_time FROM bookings
    WHERE barber_id = $1
    AND appointment_date = $2
    AND status NOT IN ('cancelled', 'completed')
  `;
  if (excludeBookingId) {
    bookingQuery += ` AND id != $${bookingParams.length + 1}`;
    bookingParams.push(excludeBookingId);
  }

  const [bookingRows, blockRows] = await Promise.all([
    db.query(bookingQuery, bookingParams),
    db.query(
      `SELECT id, start_time, end_time, is_full_day FROM barber_time_off
       WHERE barber_id = $1 AND date = $2`,
      [barberId, date]
    ),
  ]);

  const hasBookingConflict = bookingRows.rows.some((row) => {
    const existingStart = timeToMinutes(row.start_time);
    const existingEnd = timeToMinutes(row.end_time);
    if (existingStart === null || existingEnd === null) return false;
    return rangesOverlap(newStart, newEnd, existingStart, existingEnd);
  });

  if (hasBookingConflict) return { conflict: true, reason: "booking" };

  const hasBlockConflict = blockRows.rows.some((row) => {
    if (row.is_full_day) return true;
    const blockedStart = timeToMinutes(row.start_time);
    const blockedEnd = timeToMinutes(row.end_time);
    if (blockedStart === null || blockedEnd === null) return false;
    return rangesOverlap(newStart, newEnd, blockedStart, blockedEnd);
  });

  if (hasBlockConflict) return { conflict: true, reason: "blocked" };

  return { conflict: false };
};

/**
 * Create a new booking
 * POST /api/bookings
 * Accepts both frontend format (services array with id, price, duration) and standard format
 */
export const createBooking = async (req, res) => {
  let client;
  try {
    const userId = req.user.id;
    const { 
      studioId, 
      barberId, 
      services,
      date,
      startTime,
      notes,
      paymentMethod
    } = req.body;

    // Support both formats: frontend sends services as array or serviceIds
    let serviceIds;
    let serviceData = [];
    
    if (Array.isArray(services) && services.length > 0) {
      // Frontend format: [{ serviceId, price, duration }, ...] or [{ id, ... }]
      if (
        typeof services[0] === "object" &&
        services[0] !== null &&
        ("serviceId" in services[0] || "id" in services[0])
      ) {
        serviceIds = services.map((s) => s.serviceId ?? s.id);
        serviceData = services;
      } else {
        // Just array of IDs
        serviceIds = services;
      }
    } else if (req.body.serviceIds) {
      serviceIds = req.body.serviceIds;
    }

    // Support both date formats
    const appointmentDate = date || req.body.appointmentDate;
    const appointmentTime = startTime || req.body.appointmentTime;

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

    const normalizedServiceIds = serviceIds.map((id) => String(id));
    const uniqueServiceIds = [...new Set(normalizedServiceIds)];

    // Always use DB values for price/duration and ensure services belong to selected studio.
    const servicesResult = await pool.query(
      `SELECT id, name, price, duration FROM services WHERE id::text = ANY($1) AND studio_id = $2`,
      [uniqueServiceIds, studioId]
    );

    if (servicesResult.rows.length !== uniqueServiceIds.length) {
      return res.status(400).json({ error: "One or more services not found for this studio" });
    }

    const serviceMap = new Map(
      servicesResult.rows.map((service) => [
        String(service.id),
        {
          id: service.id,
          name: service.name,
          price: service.price === null || service.price === undefined ? null : Number(service.price),
          duration: service.duration === null || service.duration === undefined ? null : Number(service.duration),
        },
      ])
    );

    serviceData = normalizedServiceIds.map((serviceId) => serviceMap.get(serviceId)).filter(Boolean);

    if (serviceData.length !== normalizedServiceIds.length) {
      return res.status(400).json({ error: "Invalid services in request" });
    }

    const invalidService = serviceData.find(
      (service) =>
        service.price === null ||
        service.duration === null ||
        Number.isNaN(service.price) ||
        Number.isNaN(service.duration)
    );

    if (invalidService) {
      return res.status(400).json({ error: "Selected service has invalid price or duration" });
    }

    const totalPrice = serviceData.reduce((sum, service) => sum + Number(service.price), 0);
    const totalDuration = serviceData.reduce((sum, service) => sum + Number(service.duration), 0);

    // Create booking
    const normalizedStartTime = String(appointmentTime).length === 5 ? `${appointmentTime}:00` : String(appointmentTime);
    const calculatedEndTime = addMinutesToTime(normalizedStartTime, totalDuration);

    client = await pool.connect();
    await client.query("BEGIN");

    // Serialize conflict-checking + insertion per barber so two simultaneous
    // requests for an overlapping slot can't both pass the check before either commits.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(barberId)]);

    const conflict = await findBarberConflict(client, {
      barberId,
      date: appointmentDate,
      startTime: normalizedStartTime,
      endTime: calculatedEndTime,
    });

    if (conflict.conflict) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:
          conflict.reason === "blocked"
            ? "Barber is unavailable at this time"
            : "Time slot not available",
      });
    }

    const [bookingsHasIntegerId, bookingServicesHasIntegerId] = await Promise.all([
      tableHasIntegerId(client, "bookings"),
      tableHasIntegerId(client, "booking_services"),
    ]);

    const bookingInsertParams = [
      userId,
      studioId,
      barberId,
      appointmentDate,
      normalizedStartTime,
      calculatedEndTime,
      appointmentDate,
      normalizedStartTime,
      totalPrice,
      totalPrice,
      totalDuration,
      sanitizeString(notes || ""),
      paymentMethod || "card",
    ];

    const bookingInsertQuery = bookingsHasIntegerId
      ? `INSERT INTO bookings
         (user_id, studio_id, barber_id, booking_date, start_time, end_time,
          appointment_date, appointment_time, total_amount, total_price, total_duration,
          notes, status, payment_status, payment_method, created_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, 'pending', 'pending', $13, NOW())
         RETURNING *`
      : `INSERT INTO bookings
         (id, user_id, studio_id, barber_id, booking_date, start_time, end_time,
          appointment_date, appointment_time, total_amount, total_price, total_duration,
          notes, status, payment_status, payment_method, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, 'pending', 'pending', $13, NOW())
         RETURNING *`;

    const result = await client.query(bookingInsertQuery, bookingInsertParams);

    const bookingId = result.rows[0].id;
    const bookingServicesInsertQuery = bookingServicesHasIntegerId
      ? `INSERT INTO booking_services (booking_id, service_id, price, duration) VALUES ($1, $2, $3, $4)`
      : `INSERT INTO booking_services (id, booking_id, service_id, price, duration) VALUES (gen_random_uuid(), $1, $2, $3, $4)`;

    // Insert booking services
    for (const service of serviceData) {
      await client.query(
        bookingServicesInsertQuery,
        [bookingId, service.id, service.price, service.duration]
      );
    }

    // Generate confirmation code
    const confirmationCode = `REV${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(0, 20);
    await client.query(
      `UPDATE bookings SET confirmation_code = $1 WHERE id = $2`,
      [confirmationCode, bookingId]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Booking created successfully",
      booking: {
        ...result.rows[0],
        confirmationCode,
        services: serviceData
      }
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }
    console.error("Create booking error:", error);
    res.status(500).json({ error: "Failed to create booking" });
  } finally {
    if (client) {
      client.release();
    }
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
        COALESCE(
          json_agg(
            json_build_object(
              'id', sv.id,
              'name', sv.name,
              'price', COALESCE(bs.price, sv.price),
              'duration', COALESCE(bs.duration, sv.duration)
            )
          ) FILTER (WHERE bs.service_id IS NOT NULL),
          '[]'::json
        ) as services
      FROM bookings b
      JOIN studios s ON b.studio_id = s.id
      JOIN barbers br ON b.barber_id = br.id
      LEFT JOIN booking_services bs ON b.id = bs.booking_id
      LEFT JOIN services sv ON bs.service_id = sv.id
      WHERE b.user_id = $1
    `;

    const params = [userId];

    if (status) {
      const statusValues = String(status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (statusValues.length === 1) {
        query += ` AND b.status = $${params.length + 1}`;
        params.push(statusValues[0]);
      } else if (statusValues.length > 1) {
        query += ` AND b.status = ANY($${params.length + 1})`;
        params.push(statusValues);
      }
    }

    query += `
      GROUP BY b.id, s.id, br.id
      ORDER BY b.appointment_date DESC, b.appointment_time DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, (page - 1) * limit);

    const result = await pool.query(query, params);

    // Get total count
    const countParams = [userId];
    let countQuery = `SELECT COUNT(*) FROM bookings WHERE user_id = $1`;

    if (status) {
      const statusValues = String(status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (statusValues.length === 1) {
        countQuery += ` AND status = $2`;
        countParams.push(statusValues[0]);
      } else if (statusValues.length > 1) {
        countQuery += ` AND status = ANY($2)`;
        countParams.push(statusValues);
      }
    }

    const countResult = await pool.query(countQuery, countParams);

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
        b.id as booking_id,
        b.studio_id,
        b.barber_id,
        b.appointment_date as booking_date,
        b.appointment_time,
        b.status,
        COALESCE(b.total_amount, b.total_price) as total_price,
        b.confirmation_code,
        s.name as studio_name,
        s.address as studio_address,
        s.phone as studio_phone,
        s.image_url as studio_image,
        s.lat, s.lng,
        br.name as barber_name,
        br.image_url as barber_image,
        br.rating as barber_rating,
        COALESCE(
          json_agg(
            json_build_object(
              'name', sv.name,
              'price', COALESCE(bs.price, sv.price),
              'duration', COALESCE(bs.duration, sv.duration)
            )
          ) FILTER (WHERE bs.service_id IS NOT NULL),
          '[]'::json
        ) as services
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
    // Support both frontend and backend field names
    const { date, startTime, appointmentDate, appointmentTime } = req.body;
    
    const newDate = date || appointmentDate;
    const newTime = startTime || appointmentTime;

    if (!newDate || !newTime) {
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
    const newDateTime = new Date(`${newDate}T${newTime}`);
    if (newDateTime <= new Date()) {
      return res.status(400).json({ error: "New appointment must be in the future" });
    }

    const normalizedStartTime = String(newTime).length === 5 ? `${newTime}:00` : String(newTime);
    const totalDuration = Number(bookingData.total_duration || 0);
    const calculatedEndTime = addMinutesToTime(normalizedStartTime, totalDuration);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(bookingData.barber_id)]);

      const conflict = await findBarberConflict(client, {
        barberId: bookingData.barber_id,
        date: newDate,
        startTime: normalizedStartTime,
        endTime: calculatedEndTime,
        excludeBookingId: id,
      });

      if (conflict.conflict) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error:
            conflict.reason === "blocked"
              ? "Barber is unavailable at the new time"
              : "New time slot not available",
        });
      }

      await client.query(
        `UPDATE bookings
         SET booking_date = $1,
             start_time = $2,
             end_time = $3,
             appointment_date = $4,
             appointment_time = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [newDate, normalizedStartTime, calculatedEndTime, newDate, normalizedStartTime, id]
      );

      await client.query("COMMIT");
    } catch (innerError) {
      await client.query("ROLLBACK");
      throw innerError;
    } finally {
      client.release();
    }

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
    const { studioId, barberId, date, duration } = req.query;

    if (!barberId || !date) {
      return res.status(400).json({ error: "Barber ID and date required" });
    }

    // The grid granularity slots are offered at - actual occupied time is
    // computed from real bookings/blocks, this is just the candidate start times.
    const defaultSlots = [
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
      "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
      "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
      "18:00", "18:30", "19:00", "19:30", "20:00"
    ];

    // How long the slot being requested would actually occupy the barber's time.
    // Falls back to the grid granularity (30 min) when the caller hasn't picked services yet.
    const slotDuration = Math.max(Number(duration) || 30, 30);

    const [bookedRows, blockedRows] = await Promise.all([
      pool.query(
        `SELECT start_time, end_time
         FROM bookings
         WHERE barber_id = $1
         AND appointment_date = $2
         AND status NOT IN ('cancelled', 'completed')`,
        [barberId, date]
      ),
      pool.query(
        `SELECT start_time, end_time, is_full_day
         FROM barber_time_off
         WHERE barber_id = $1 AND date = $2`,
        [barberId, date]
      ),
    ]);

    if (blockedRows.rows.some((row) => row.is_full_day)) {
      return res.json({ slots: [] });
    }

    const occupiedRanges = [...bookedRows.rows, ...blockedRows.rows]
      .map((row) => [timeToMinutes(row.start_time), timeToMinutes(row.end_time)])
      .filter(([start, end]) => start !== null && end !== null);

    let availableSlots = defaultSlots.filter((slot) => {
      const slotStart = timeToMinutes(slot);
      const slotEnd = slotStart + slotDuration;
      return !occupiedRanges.some(([start, end]) => rangesOverlap(slotStart, slotEnd, start, end));
    });

    // If date is today, filter out past times
    const today = new Date().toISOString().split("T")[0];
    if (date === today) {
      const currentHour = new Date().getHours();
      const currentMin = new Date().getMinutes();
      const currentTime = `${currentHour.toString().padStart(2, "0")}:${currentMin.toString().padStart(2, "0")}`;
      availableSlots = availableSlots.filter(slot => slot > currentTime);
    }

    res.json({ slots: availableSlots });
  } catch (error) {
    console.error("Get availability error:", error);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
};
