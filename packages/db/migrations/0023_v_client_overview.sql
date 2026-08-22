CREATE VIEW "coaching"."v_client_overview" AS (
  SELECT
    cp.id                AS client_id,
    cp.coach_id,
    u.name,
    cp.status,
    u.last_active_at,
    (SELECT count(*) FROM training.workout_sessions ws
      WHERE ws.client_id = cp.id AND ws.status = 'completed'
        AND ws.scheduled_date >= current_date - 7)                       AS sessions_completed_7d,
    (SELECT count(*) FROM training.workout_sessions ws
      WHERE ws.client_id = cp.id AND ws.scheduled_date BETWEEN current_date - 7 AND current_date) AS sessions_scheduled_7d,
    (SELECT count(*) FROM training.workout_sessions ws
      WHERE ws.client_id = cp.id AND ws.status='completed' AND ws.reviewed_at IS NULL) AS unreviewed_sessions,
    (SELECT count(*) FROM coaching.media_assets ma
      WHERE ma.client_id = cp.id AND ma.processing_status='ready' AND ma.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM coaching.comments c
                        WHERE c.target_type='media_asset' AND c.target_id = ma.id)) AS unreviewed_videos,
    (SELECT avg(dns.adherence_score) FROM nutrition.daily_nutrition_summary dns
      WHERE dns.client_id = cp.id AND dns.date >= current_date - 7)       AS nutrition_adherence_7d,
    (SELECT bm.weight_kg FROM coaching.body_metrics bm
      WHERE bm.client_id = cp.id ORDER BY bm.recorded_at DESC LIMIT 1)    AS latest_weight_kg
  FROM identity.client_profiles cp
  JOIN identity.users u ON u.id = cp.user_id
  WHERE cp.deleted_at IS NULL
);