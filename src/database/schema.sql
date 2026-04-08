-- =============================================
-- Revoras Backend Database Schema
-- Run this migration to set up all tables
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Studios table
CREATE TABLE IF NOT EXISTS studios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    address VARCHAR(500) NOT NULL,
    city VARCHAR(100),
    state VARCHAR(100),
    zip_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'USA',
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    phone VARCHAR(20),
    email VARCHAR(255),
    image_url VARCHAR(500),
    gallery JSONB DEFAULT '[]',
    rating DECIMAL(2, 1) DEFAULT 0,
    review_count INT DEFAULT 0,
    amenities JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Studio working hours
CREATE TABLE IF NOT EXISTS studio_hours (
    id SERIAL PRIMARY KEY,
    studio_id INT REFERENCES studios(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time TIME,
    close_time TIME,
    is_closed BOOLEAN DEFAULT false,
    UNIQUE(studio_id, day_of_week)
);

-- Services table
CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    studio_id INT REFERENCES studios(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) DEFAULT 'General',
    price DECIMAL(10, 2) NOT NULL,
    duration INT NOT NULL, -- in minutes
    image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add studio_id to barbers if not exists
ALTER TABLE barbers 
ADD COLUMN IF NOT EXISTS studio_id INT REFERENCES studios(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS title VARCHAR(255),
ADD COLUMN IF NOT EXISTS experience_years INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS rating DECIMAL(2, 1) DEFAULT 0;

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    studio_id INT REFERENCES studios(id) ON DELETE CASCADE,
    barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    booking_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
    notes TEXT,
    cancellation_reason TEXT,
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded', 'failed')),
    payment_method VARCHAR(50),
    confirmation_code VARCHAR(20) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Booking services junction table
CREATE TABLE IF NOT EXISTS booking_services (
    id SERIAL PRIMARY KEY,
    booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
    service_id INT REFERENCES services(id) ON DELETE CASCADE,
    price DECIMAL(10, 2) NOT NULL,
    duration INT NOT NULL
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
    studio_id INT REFERENCES studios(id) ON DELETE CASCADE,
    barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title VARCHAR(255),
    comment TEXT,
    photos JSONB DEFAULT '[]',
    helpful_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Review helpful tracking
CREATE TABLE IF NOT EXISTS review_helpful (
    id SERIAL PRIMARY KEY,
    review_id INT REFERENCES reviews(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(review_id, user_id)
);

-- User favorites
CREATE TABLE IF NOT EXISTS user_favorites (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    studio_id INT REFERENCES studios(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, studio_id)
);

-- Add additional fields to users if not exists
ALTER TABLE users
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{"email": true, "push": true, "sms": false, "marketing": false}',
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- =============================================
-- Indexes for Performance
-- =============================================

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_studio ON bookings(studio_id);
CREATE INDEX IF NOT EXISTS idx_bookings_barber ON bookings(barber_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_reviews_studio ON reviews(studio_id);
CREATE INDEX IF NOT EXISTS idx_reviews_barber ON reviews(barber_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_services_studio ON services(studio_id);
CREATE INDEX IF NOT EXISTS idx_barbers_studio ON barbers(studio_id);
CREATE INDEX IF NOT EXISTS idx_studios_location ON studios(lat, lng);
CREATE INDEX IF NOT EXISTS idx_studios_active ON studios(is_active);

-- =============================================
-- Trigger for updated_at timestamps
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_studios_updated_at ON studios;
CREATE TRIGGER update_studios_updated_at
    BEFORE UPDATE ON studios
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Seed Data for Testing (Optional)
-- =============================================

-- Insert sample studio
INSERT INTO studios (name, description, address, city, state, lat, lng, rating, image_url)
VALUES (
    'Revoras Downtown',
    'Premium grooming experience in the heart of the city',
    '123 Main Street',
    'San Francisco',
    'CA',
    37.7749,
    -122.4194,
    4.8,
    '/images/studio-downtown.jpg'
) ON CONFLICT DO NOTHING;

-- Insert studio hours for the sample studio
INSERT INTO studio_hours (studio_id, day_of_week, open_time, close_time)
SELECT 1, day, '09:00', '21:00'
FROM generate_series(1, 5) as day
ON CONFLICT DO NOTHING;

INSERT INTO studio_hours (studio_id, day_of_week, open_time, close_time)
VALUES (1, 6, '10:00', '18:00') ON CONFLICT DO NOTHING;

INSERT INTO studio_hours (studio_id, day_of_week, open_time, close_time, is_closed)
VALUES (1, 0, NULL, NULL, true) ON CONFLICT DO NOTHING;

-- Insert sample services
INSERT INTO services (studio_id, name, description, category, price, duration)
VALUES 
    (1, 'Classic Haircut', 'Traditional precision haircut with styling', 'Haircuts', 45.00, 30),
    (1, 'Executive Cut', 'Premium cut with hot towel service', 'Haircuts', 65.00, 45),
    (1, 'Beard Trim', 'Professional beard shaping and trim', 'Beard', 25.00, 20),
    (1, 'Hot Towel Shave', 'Traditional straight razor shave', 'Shaves', 55.00, 45),
    (1, 'Hair + Beard Combo', 'Complete grooming package', 'Combos', 80.00, 60)
ON CONFLICT DO NOTHING;
