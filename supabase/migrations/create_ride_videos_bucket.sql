-- Create the ride-videos storage bucket (public read, authenticated write)
-- Run this once in the Supabase SQL editor or via supabase db push

INSERT INTO storage.buckets (id, name, public)
VALUES ('ride-videos', 'ride-videos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: anyone can read (public bucket)
CREATE POLICY "Public read ride-videos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ride-videos');

-- RLS: authenticated users can upload
CREATE POLICY "Auth upload ride-videos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'ride-videos');

-- RLS: anon can also upload (pre-auth MVP — tighten after login is shipped)
CREATE POLICY "Anon upload ride-videos"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'ride-videos');
