-- =============================================
-- Admin Panel Migration
-- Adds admin users table and studio approval workflow
-- =============================================

-- Create admins table
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add approval_status to studios (if not exists)
ALTER TABLE studios 
ADD COLUMN IF NOT EXISTS approval_status VARCHAR(50) DEFAULT 'pending' 
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended'));

-- Add admin notes and approval tracking
ALTER TABLE studios
ADD COLUMN IF NOT EXISTS admin_notes TEXT,
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES admins(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Update existing studios to be approved (for backward compatibility)
UPDATE studios SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = 'pending';

-- Create index for approval status queries
CREATE INDEX IF NOT EXISTS idx_studios_approval_status ON studios(approval_status);

-- Create admin activity log table
CREATE TABLE IF NOT EXISTS admin_activity_log (
    id SERIAL PRIMARY KEY,
    admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_admin ON admin_activity_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_created ON admin_activity_log(created_at DESC);

-- Trigger for admin updated_at
DROP TRIGGER IF EXISTS update_admins_updated_at ON admins;
CREATE TRIGGER update_admins_updated_at
    BEFORE UPDATE ON admins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default super admin (password: admin123 - CHANGE IN PRODUCTION!)
-- Password hash for 'admin123' using bcrypt with 10 rounds
INSERT INTO admins (name, email, password, role)
VALUES (
    'Super Admin',
    'admin@snapcut.com',
    '$2b$10$rQZ8K8HvhJH8X5F5X5X5X.X5X5X5X5X5X5X5X5X5X5X5X5X5X5X5X',
    'super_admin'
) ON CONFLICT (email) DO NOTHING;

-- Note: The password hash above is a placeholder. 
-- You should generate a real hash using: 
-- const bcrypt = require('bcrypt'); bcrypt.hashSync('your_password', 10)
