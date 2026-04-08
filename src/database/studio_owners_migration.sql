-- =============================================
-- Studio Owners Table Migration
-- Separates studio ownership from barber accounts
-- =============================================

-- Studio Owners table (shop owners who manage the business)
CREATE TABLE IF NOT EXISTS studio_owners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    studio_id INT REFERENCES studios(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'admin')),
    image_url VARCHAR(500),
    email_verified BOOLEAN DEFAULT false,
    phone_verified BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_studio_owners_email ON studio_owners(email);
CREATE INDEX IF NOT EXISTS idx_studio_owners_phone ON studio_owners(phone);
CREATE INDEX IF NOT EXISTS idx_studio_owners_studio ON studio_owners(studio_id);

-- Update trigger for studio_owners
DROP TRIGGER IF EXISTS update_studio_owners_updated_at ON studio_owners;
CREATE TRIGGER update_studio_owners_updated_at
    BEFORE UPDATE ON studio_owners
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Update barbers table to be employees of studios
-- =============================================

-- Ensure barbers table has the right structure
-- (barbers are now employees, not studio creators)
ALTER TABLE barbers 
ADD COLUMN IF NOT EXISTS password VARCHAR(255),
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

-- =============================================
-- Comments explaining the new structure
-- =============================================

COMMENT ON TABLE studio_owners IS 'Shop owners/managers who own and manage barbershop studios';
COMMENT ON TABLE barbers IS 'Barbers who work at studios as employees';
COMMENT ON COLUMN studio_owners.role IS 'owner = full access, manager = limited admin, admin = super admin';
COMMENT ON COLUMN barbers.studio_id IS 'The studio where this barber works (set by studio owner)';
