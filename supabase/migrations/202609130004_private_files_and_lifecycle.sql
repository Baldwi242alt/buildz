-- Bounded private evidence storage for the hackathon deployment. Move binary
-- payloads behind an object-storage adapter before a larger school pilot.
CREATE TABLE app.project_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES app.projects(id),
 uploaded_by uuid NOT NULL REFERENCES app.profiles(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 2097152),
 sha256 text NOT NULL CHECK(length(sha256)=64), content bytea NOT NULL CHECK(octet_length(content)=size_bytes),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_files_project ON app.project_files(project_id,created_at DESC,id DESC);
ALTER TABLE app.project_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY files_read ON app.project_files FOR SELECT TO buildz_api USING(app.workflow_access(project_id));
CREATE POLICY files_insert ON app.project_files FOR INSERT TO buildz_api WITH CHECK(app.is_project_member(project_id) AND uploaded_by=app.actor_id());
GRANT SELECT,INSERT ON app.project_files TO buildz_api;

CREATE FUNCTION app.lock_member_project(project uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.is_project_member(project) THEN RETURN false; END IF;
 PERFORM 1 FROM app.projects WHERE id=project AND lifecycle<>'archived' FOR UPDATE; RETURN FOUND;
END $$;
CREATE FUNCTION app.has_active_reservations(project uuid,person uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.is_project_member(project) AND (EXISTS(SELECT 1 FROM app.bookings b WHERE b.project_id=project AND b.state IN ('pending','confirmed') AND b.ends_at>now()
 AND (person IS NULL OR person=ANY(b.attendees))) OR EXISTS(SELECT 1 FROM app.consultations c JOIN app.consultation_slots s ON s.id=c.slot_id
 WHERE c.project_id=project AND c.state='booked' AND s.ends_at>now() AND (person IS NULL OR c.booked_by=person))) $$;
CREATE FUNCTION app.publication_blocked(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (app.is_project_owner(project) OR app.reviews_project(project)) AND EXISTS(SELECT 1 FROM app.content_reports r WHERE r.project_id=project AND r.state='removed') $$;
GRANT EXECUTE ON FUNCTION app.lock_member_project(uuid),app.has_active_reservations(uuid,uuid),app.publication_blocked(uuid) TO buildz_api;

-- A removed/left student cannot remain attached to a future reservation.
CREATE OR REPLACE FUNCTION app.leave_project(project uuid, expected_version integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog AS $$
DECLARE owner uuid; revision integer; BEGIN
 SELECT owner_id,version INTO owner,revision FROM app.projects WHERE id=project FOR UPDATE;
 IF NOT FOUND OR owner=app.actor_id() OR revision<>expected_version OR app.has_active_reservations(project,app.actor_id()) THEN RETURN false; END IF;
 DELETE FROM app.project_memberships WHERE project_id=project AND user_id=app.actor_id();
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE app.project_invitations SET state='revoked' WHERE project_id=project AND recipient_email=app.actor_email() AND state='pending';
 UPDATE app.projects SET version=version+1,updated_at=now() WHERE id=project;
 INSERT INTO app.audit_events(actor_id,action,subject_id) VALUES(app.actor_id(),'project.member_left',project);
 INSERT INTO app.outbox_events(actor_id,type,aggregate_id) VALUES(app.actor_id(),'project.member_changed',project);
 RETURN true;
END $$;
