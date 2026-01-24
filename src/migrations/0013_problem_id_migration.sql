-- Migration: Convert problem content to problem ID
-- All existing experiments had problem content stored directly.
-- This migration updates them to use the legacy.problem placeholder.

UPDATE experiments SET problem = 'legacy.problem';
