-- 010: fn_similar_teams returns no rows for a team without a profile vector.
--   An empty team's team_profile_vector is NULL, so every cosine distance to it
--   was NULL and the function returned other teams with a NULL similarity.
--   OR REPLACE keeps the grants from 008.

CREATE OR REPLACE FUNCTION fn_similar_teams(p_team_id INTEGER, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (team_id INTEGER, team_name TEXT, similarity NUMERIC)
LANGUAGE sql STABLE AS $$
    WITH q AS (SELECT team_profile_vector AS v FROM competitive_team WHERE team_identification_number = p_team_id)
    SELECT t.team_identification_number, t.team_name::TEXT,
           round((1 - (t.team_profile_vector <=> q.v))::NUMERIC, 3)
    FROM competitive_team t, q
    WHERE t.team_identification_number <> p_team_id AND t.team_profile_vector IS NOT NULL
      AND q.v IS NOT NULL
    ORDER BY t.team_profile_vector <=> q.v
    LIMIT p_limit
$$;
