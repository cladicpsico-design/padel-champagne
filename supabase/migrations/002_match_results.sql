-- ============================================================
-- 002_match_results.sql
-- Sistema de resultados y clasificación automática
-- Run in: Supabase dashboard → SQL Editor → New query
-- ============================================================

-- ── 1. Tabla match_results ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS match_results (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  -- Marcadores por set (Equipo A = player1+player2, Equipo B = player3+player4)
  set1_team1   SMALLINT    NOT NULL CHECK (set1_team1 >= 0),
  set1_team2   SMALLINT    NOT NULL CHECK (set1_team2 >= 0),
  set2_team1   SMALLINT    CHECK (set2_team1 >= 0),
  set2_team2   SMALLINT    CHECK (set2_team2 >= 0),
  set3_team1   SMALLINT    CHECK (set3_team1 >= 0),  -- solo si 1-1 en sets
  set3_team2   SMALLINT    CHECK (set3_team2 >= 0),
  winner_team  SMALLINT    NOT NULL CHECK (winner_team IN (1, 2)),
  -- Quién introdujo y confirmó
  submitted_by UUID        REFERENCES players(id) ON DELETE SET NULL,
  confirmed_by UUID        REFERENCES players(id) ON DELETE SET NULL,
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id)  -- un resultado por partido
);

-- ── 2. RLS ─────────────────────────────────────────────────────

ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;

-- Cualquiera puede ver los resultados (página pública de clasificación)
CREATE POLICY "Anyone can view match results"
  ON match_results FOR SELECT USING (TRUE);

-- Usuarios autenticados pueden insertar (el frontend valida que estén en el partido)
CREATE POLICY "Authenticated users can insert results"
  ON match_results FOR INSERT TO authenticated WITH CHECK (TRUE);

-- Usuarios autenticados pueden actualizar (para confirmación)
CREATE POLICY "Authenticated users can update results"
  ON match_results FOR UPDATE TO authenticated USING (TRUE);

-- ── 3. RPC: get_group_standings ────────────────────────────────
-- Devuelve la clasificación de un grupo calculada desde match_results.
-- Los resultados "pending" de más de 24h se tratan como confirmados.
-- Muestra TODOS los jugadores activos, aunque no hayan jugado (0 partidos).

CREATE OR REPLACE FUNCTION get_group_standings(p_group TEXT)
RETURNS TABLE (
  player_id UUID,
  jugador   TEXT,
  pj        BIGINT,
  ganados   BIGINT,
  perdidos  BIGINT,
  pts       BIGINT,
  rating    NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH effective_results AS (
    -- Resultados que cuentan: confirmados O pendientes con más de 24h
    SELECT
      m.player1_id,
      m.player2_id,
      m.player3_id,
      m.player4_id,
      r.winner_team
    FROM matches m
    JOIN match_results r ON r.match_id = m.id
    WHERE m.group_name = p_group
      AND (
        r.status = 'confirmed'
        OR (r.status = 'pending' AND r.created_at < NOW() - INTERVAL '24 hours')
      )
  ),
  player_results AS (
    -- Expandir: un registro por jugador por partido
    SELECT player1_id AS player_id, CASE WHEN winner_team = 1 THEN 1 ELSE 0 END AS won FROM effective_results
    UNION ALL
    SELECT player2_id, CASE WHEN winner_team = 1 THEN 1 ELSE 0 END FROM effective_results
    UNION ALL
    SELECT player3_id, CASE WHEN winner_team = 2 THEN 1 ELSE 0 END FROM effective_results
    UNION ALL
    SELECT player4_id, CASE WHEN winner_team = 2 THEN 1 ELSE 0 END FROM effective_results
  )
  SELECT
    p.id                                                            AS player_id,
    p.name                                                          AS jugador,
    COUNT(pr.player_id)                                             AS pj,
    COALESCE(SUM(pr.won), 0)                                        AS ganados,
    COUNT(pr.player_id) - COALESCE(SUM(pr.won), 0)                 AS perdidos,
    COALESCE(SUM(pr.won), 0) * 2                                    AS pts,
    CASE WHEN COUNT(pr.player_id) > 0
      THEN ROUND(COALESCE(SUM(pr.won), 0)::NUMERIC * 2 / COUNT(pr.player_id), 2)
      ELSE 0
    END                                                             AS rating
  FROM players p
  LEFT JOIN player_results pr ON pr.player_id = p.id
  WHERE p.group_name = p_group
    AND p.payment_status IN ('paid', 'exempt')
  GROUP BY p.id, p.name
  ORDER BY rating DESC, pts DESC, p.name ASC;
$$;

-- Accesible desde el frontend (anon + authenticated)
GRANT EXECUTE ON FUNCTION get_group_standings(TEXT) TO anon, authenticated;
