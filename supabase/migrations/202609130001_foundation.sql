-- Application data stays outside Supabase's exposed public schema.
-- Run as the migration owner. Runtime roles deliberately do not own tables.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'buildz_api') THEN
    CREATE ROLE buildz_api NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'buildz_worker') THEN
    CREATE ROLE buildz_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO buildz_api, buildz_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE app.profiles (
  id uuid PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(email)),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  timezone text NOT NULL DEFAULT 'Asia/Singapore',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profiles_email_unique ON app.profiles (email);
CREATE TABLE app.institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 150),
  slug text NOT NULL UNIQUE,
  timezone text NOT NULL DEFAULT 'Asia/Singapore',
  currency text NOT NULL DEFAULT 'SGD',
  is_demo boolean NOT NULL DEFAULT false
);
CREATE TABLE app.institution_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES app.institutions(id),
  user_id uuid NOT NULL REFERENCES app.profiles(id),
  affiliation text NOT NULL CHECK (affiliation IN ('student','staff')),
  status text NOT NULL CHECK (status IN ('verified','revoked')),
  verified_by uuid REFERENCES app.profiles(id),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, user_id, affiliation)
);
CREATE INDEX memberships_user ON app.institution_memberships (user_id, institution_id);
CREATE TABLE app.role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES app.institutions(id),
  user_id uuid NOT NULL REFERENCES app.profiles(id),
  role text NOT NULL CHECK (role IN ('institution_admin','reviewer','resource_manager')),
  granted_by uuid REFERENCES app.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX active_roles ON app.role_assignments(institution_id,user_id,role) WHERE revoked_at IS NULL;
CREATE TABLE app.verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES app.institutions(id),
  user_id uuid NOT NULL REFERENCES app.profiles(id),
  statement text NOT NULL CHECK (length(statement) BETWEEN 1 AND 1000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  decided_by uuid REFERENCES app.profiles(id),
  reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pending_verification ON app.verification_requests(institution_id,user_id) WHERE state='pending';

CREATE TABLE app.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_institution_id uuid NOT NULL REFERENCES app.institutions(id),
  owner_id uuid NOT NULL REFERENCES app.profiles(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 150),
  project_type text NOT NULL CHECK (project_type IN ('business','engineering','creative','community','other')),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 2000),
  lifecycle text NOT NULL DEFAULT 'idea' CHECK (lifecycle IN ('idea','active','completed','archived')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.project_memberships (
  project_id uuid NOT NULL REFERENCES app.projects(id),
  user_id uuid NOT NULL REFERENCES app.profiles(id),
  role text NOT NULL CHECK (role IN ('editor','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,user_id)
);
ALTER TABLE app.projects ADD CONSTRAINT project_owner_is_member
  FOREIGN KEY(id,owner_id) REFERENCES app.project_memberships(project_id,user_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX project_memberships_user ON app.project_memberships(user_id,project_id);
CREATE INDEX projects_page ON app.projects(created_at DESC,id DESC);
CREATE TABLE app.project_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app.projects(id),
  recipient_email text NOT NULL CHECK (recipient_email=lower(recipient_email)),
  role text NOT NULL CHECK (role IN ('editor','member')),
  invited_by uuid NOT NULL REFERENCES app.profiles(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','declined','revoked','expired')),
  accepted_by uuid REFERENCES app.profiles(id),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pending_invitation ON app.project_invitations(project_id,recipient_email) WHERE state='pending';
CREATE INDEX invitation_inbox ON app.project_invitations(recipient_email,created_at DESC,id DESC);
CREATE INDEX invitation_expiry ON app.project_invitations(expires_at) WHERE state='pending';

CREATE TABLE app.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES app.profiles(id),
  action text NOT NULL,
  subject_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  aggregate_id uuid NOT NULL,
  actor_id uuid REFERENCES app.profiles(id),
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.idempotency_records (
  actor_id uuid NOT NULL REFERENCES app.profiles(id),
  operation text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,operation,key)
);

CREATE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('app.actor_id',true),'')::uuid $$;
CREATE FUNCTION app.actor_email() RETURNS text LANGUAGE sql STABLE
  SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('app.actor_email',true),'') $$;
-- These narrowly scoped predicates avoid recursive membership RLS.
CREATE FUNCTION app.is_admin(school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT EXISTS (SELECT 1 FROM app.role_assignments r
    WHERE r.institution_id=school AND r.user_id=app.actor_id()
    AND r.role='institution_admin' AND r.revoked_at IS NULL) $$;
CREATE FUNCTION app.is_project_member(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT EXISTS(SELECT 1 FROM app.project_memberships m WHERE m.project_id=project AND m.user_id=app.actor_id()) $$;
CREATE FUNCTION app.is_project_owner(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT EXISTS(SELECT 1 FROM app.projects p WHERE p.id=project AND p.owner_id=app.actor_id()) $$;
CREATE FUNCTION app.can_edit_project(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT app.is_project_owner(project) OR EXISTS(SELECT 1 FROM app.project_memberships m
    WHERE m.project_id=project AND m.user_id=app.actor_id() AND m.role='editor') $$;
CREATE FUNCTION app.can_read_profile(person uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT person=app.actor_id() OR EXISTS(SELECT 1 FROM app.project_memberships a
    JOIN app.project_memberships b ON a.project_id=b.project_id
    WHERE a.user_id=app.actor_id() AND b.user_id=person)
    OR EXISTS(SELECT 1 FROM app.institution_memberships m WHERE m.user_id=person AND app.is_admin(m.institution_id)) $$;
CREATE FUNCTION app.has_student_membership(school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT EXISTS(SELECT 1 FROM app.institution_memberships m WHERE m.institution_id=school
    AND m.user_id=app.actor_id() AND m.affiliation='student' AND m.status='verified'
    AND (m.valid_until IS NULL OR m.valid_until>now())) $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','institutions','institution_memberships','role_assignments','verification_requests',
    'projects','project_memberships','project_invitations','audit_events','outbox_events','idempotency_records'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;
CREATE POLICY profiles_read ON app.profiles FOR SELECT TO buildz_api USING (app.can_read_profile(id));
CREATE POLICY profiles_insert ON app.profiles FOR INSERT TO buildz_api WITH CHECK(id=app.actor_id() AND email=app.actor_email());
CREATE POLICY profiles_update ON app.profiles FOR UPDATE TO buildz_api USING(id=app.actor_id()) WITH CHECK(id=app.actor_id() AND email=app.actor_email());
CREATE POLICY institutions_read ON app.institutions FOR SELECT TO buildz_api USING(app.actor_id() IS NOT NULL);
CREATE POLICY institution_members_read ON app.institution_memberships FOR SELECT TO buildz_api USING(user_id=app.actor_id() OR app.is_admin(institution_id));
CREATE POLICY institution_members_insert ON app.institution_memberships FOR INSERT TO buildz_api WITH CHECK(app.is_admin(institution_id) AND user_id<>app.actor_id());
CREATE POLICY institution_members_update ON app.institution_memberships FOR UPDATE TO buildz_api USING(app.is_admin(institution_id) AND user_id<>app.actor_id());
CREATE POLICY roles_read ON app.role_assignments FOR SELECT TO buildz_api USING(user_id=app.actor_id() OR app.is_admin(institution_id));
CREATE POLICY verification_read ON app.verification_requests FOR SELECT TO buildz_api USING(user_id=app.actor_id() OR app.is_admin(institution_id));
CREATE POLICY verification_insert ON app.verification_requests FOR INSERT TO buildz_api WITH CHECK(user_id=app.actor_id() AND state='pending');
CREATE POLICY verification_update ON app.verification_requests FOR UPDATE TO buildz_api USING(app.is_admin(institution_id) AND user_id<>app.actor_id());
CREATE POLICY project_read ON app.projects FOR SELECT TO buildz_api USING(owner_id=app.actor_id() OR app.is_project_member(id));
CREATE POLICY project_insert ON app.projects FOR INSERT TO buildz_api WITH CHECK(owner_id=app.actor_id() AND app.has_student_membership(lead_institution_id));
CREATE POLICY project_update ON app.projects FOR UPDATE TO buildz_api USING(app.can_edit_project(id)) WITH CHECK(app.is_project_member(id));
CREATE POLICY team_read ON app.project_memberships FOR SELECT TO buildz_api USING(app.is_project_member(project_id) OR app.is_project_owner(project_id));
CREATE POLICY team_insert ON app.project_memberships FOR INSERT TO buildz_api WITH CHECK(app.is_project_owner(project_id));
CREATE POLICY team_delete ON app.project_memberships FOR DELETE TO buildz_api USING(app.is_project_owner(project_id) OR user_id=app.actor_id());
CREATE POLICY invitation_read ON app.project_invitations FOR SELECT TO buildz_api USING(app.is_project_owner(project_id) OR recipient_email=app.actor_email());
CREATE POLICY invitation_insert ON app.project_invitations FOR INSERT TO buildz_api WITH CHECK(app.is_project_owner(project_id) AND invited_by=app.actor_id());
CREATE POLICY invitation_update ON app.project_invitations FOR UPDATE TO buildz_api USING(app.is_project_owner(project_id) OR recipient_email=app.actor_email());
CREATE POLICY audit_insert ON app.audit_events FOR INSERT TO buildz_api WITH CHECK(actor_id=app.actor_id());
CREATE POLICY outbox_insert ON app.outbox_events FOR INSERT TO buildz_api WITH CHECK(actor_id=app.actor_id());
CREATE POLICY idempotency_own ON app.idempotency_records FOR ALL TO buildz_api USING(actor_id=app.actor_id()) WITH CHECK(actor_id=app.actor_id());

GRANT SELECT,INSERT,UPDATE ON app.profiles TO buildz_api;
GRANT SELECT ON app.institutions,app.role_assignments TO buildz_api;
GRANT SELECT,INSERT,UPDATE ON app.institution_memberships,app.verification_requests,app.projects,app.project_invitations TO buildz_api;
GRANT SELECT,INSERT,DELETE ON app.project_memberships TO buildz_api;
GRANT INSERT ON app.audit_events,app.outbox_events TO buildz_api;
GRANT SELECT,INSERT ON app.idempotency_records TO buildz_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO buildz_api;

-- Invitation acceptance is the only path that adds a non-owner through consent.
-- Lock order is always project then invitation, including removal/archive.
CREATE FUNCTION app.accept_invitation(invitation uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path=pg_catalog AS $$
DECLARE inv app.project_invitations; project_state text; BEGIN
  SELECT * INTO inv FROM app.project_invitations WHERE id=invitation AND recipient_email=app.actor_email();
  IF NOT FOUND OR app.actor_id() IS NULL THEN RETURN NULL; END IF;
  SELECT lifecycle INTO project_state FROM app.projects WHERE id=inv.project_id FOR UPDATE;
  SELECT * INTO inv FROM app.project_invitations WHERE id=invitation FOR UPDATE;
  IF inv.state='accepted' AND inv.accepted_by=app.actor_id() THEN RETURN inv.project_id; END IF;
  IF inv.state<>'pending' OR inv.expires_at<=now() OR project_state='archived' THEN RETURN NULL; END IF;
  INSERT INTO app.project_memberships(project_id,user_id,role) VALUES(inv.project_id,app.actor_id(),inv.role)
    ON CONFLICT(project_id,user_id) DO NOTHING;
  UPDATE app.project_invitations SET state='accepted',accepted_by=app.actor_id() WHERE id=inv.id;
  UPDATE app.projects SET version=version+1,updated_at=now() WHERE id=inv.project_id;
  INSERT INTO app.audit_events(actor_id,action,subject_id) VALUES(app.actor_id(),'invitation.accepted',inv.id);
  INSERT INTO app.outbox_events(actor_id,type,aggregate_id) VALUES(app.actor_id(),'project.member_changed',inv.project_id);
  RETURN inv.project_id;
END $$;
REVOKE ALL ON FUNCTION app.accept_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_invitation(uuid) TO buildz_api;

CREATE FUNCTION app.expire_invitations() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
  SET search_path=pg_catalog AS $$
DECLARE affected integer; BEGIN
  WITH expired AS (
    UPDATE app.project_invitations SET state='expired' WHERE id IN (
      SELECT id FROM app.project_invitations WHERE state='pending' AND expires_at<=now()
      ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
    ) RETURNING project_id
  ) INSERT INTO app.outbox_events(type,aggregate_id) SELECT 'invitation.expired',project_id FROM expired;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION app.expire_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_invitations() TO buildz_worker;
