-- Migration: Add image generation settings to business_profiles
-- Run this if you have an existing database

-- Add image_count column with default value of 1
ALTER TABLE business_profiles ADD COLUMN image_count INTEGER DEFAULT 1 CHECK (image_count BETWEEN 1 AND 3);

-- Add image_style column with default value of 'photorealistic'
ALTER TABLE business_profiles ADD COLUMN image_style TEXT DEFAULT 'photorealistic' CHECK (image_style IN ('photorealistic', 'illustration', '3d', 'photo'));

-- Add auto_publish column with default value of false (0)
ALTER TABLE business_profiles ADD COLUMN auto_publish BOOLEAN DEFAULT 0;
