-- Per-post comment reactions (Like / Love / …) — merchant + official page

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS react_on_comment_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS comment_reaction_type VARCHAR(20) NOT NULL DEFAULT 'LIKE';

ALTER TABLE platform_social_posts
  ADD COLUMN IF NOT EXISTS react_on_comment_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE platform_social_posts
  ADD COLUMN IF NOT EXISTS comment_reaction_type VARCHAR(20) NOT NULL DEFAULT 'LIKE';
