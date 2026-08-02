-- Create pages table for managing static pages (Privacy Policy, Terms, etc.)
CREATE TABLE IF NOT EXISTS pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(255) UNIQUE NOT NULL, -- e.g., 'privacy-policy', 'terms-of-service'
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    meta_description TEXT,
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for slug lookup
CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
CREATE INDEX IF NOT EXISTS idx_pages_published ON pages(is_published);

-- Insert default pages (content will be added via admin panel)
INSERT INTO pages (slug, title, content, is_published) VALUES
('privacy-policy', 'Privacy Policy', 
'<h1>Privacy Policy</h1>
<p>We are committed to protecting your privacy. This policy explains how we collect and use your information.</p>
<h2>Information We Collect</h2>
<p>We collect information you provide directly when registering and using the service.</p>
<h2>How We Use Your Information</h2>
<p>We use your information to provide and improve our services.</p>
<h2>Protecting Your Information</h2>
<p>We take security measures to protect your information from unauthorized access.</p>', 
TRUE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO pages (slug, title, content, is_published) VALUES
('terms-of-service', 'Terms of Service', 
'<h1>Terms of Service</h1>
<p>By using this service, you agree to comply with these terms and conditions.</p>
<h2>Use of Service</h2>
<p>The service must be used legally and in accordance with these terms.</p>
<h2>Liability</h2>
<p>We are not responsible for any damages that may result from using the service.</p>
<h2>Modifications</h2>
<p>We reserve the right to modify these terms at any time.</p>', 
TRUE)
ON CONFLICT (slug) DO NOTHING;

