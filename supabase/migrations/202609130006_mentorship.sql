-- Explicit mentor consent is separate from project publication/team membership.
CREATE TABLE app.mentorships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES app.projects(id),
 mentor_id uuid NOT NULL REFERENCES app.profiles(id),
 requested_by uuid NOT NULL REFERENCES app.profiles(id),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined','cancelled')),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mentorship_open ON app.mentorships(project_id,mentor_id) WHERE state IN ('pending','accepted');
ALTER TABLE app.mentorships ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON app.mentorships TO buildz_api;
CREATE FUNCTION app.mentor_eligible(person uuid,school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.institution_memberships m JOIN app.role_assignments r ON r.user_id=m.user_id AND r.institution_id=m.institution_id
 WHERE m.user_id=person AND m.institution_id=school AND m.affiliation='staff' AND m.status='verified' AND (m.valid_until IS NULL OR m.valid_until>now())
 AND r.revoked_at IS NULL AND r.role IN ('institution_admin','reviewer')) $$;
CREATE FUNCTION app.mentor_directory(school uuid) RETURNS TABLE(user_id uuid,display_name text,institution_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT p.id,p.display_name,m.institution_id FROM app.profiles p JOIN app.institution_memberships m ON m.user_id=p.id
 WHERE app.actor_id() IS NOT NULL AND (school IS NULL OR m.institution_id=school) AND app.mentor_eligible(p.id,m.institution_id)
 ORDER BY p.display_name,p.id,m.institution_id LIMIT 100 $$;
CREATE FUNCTION app.accepted_mentor(project uuid,person uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.mentorships m JOIN app.projects p ON p.id=m.project_id
 WHERE m.project_id=project AND m.mentor_id=person AND m.state='accepted' AND app.mentor_eligible(person,p.lead_institution_id)) $$;
CREATE POLICY mentorship_read ON app.mentorships FOR SELECT TO buildz_api USING(mentor_id=app.actor_id() OR app.is_project_member(project_id));
CREATE POLICY mentorship_insert ON app.mentorships FOR INSERT TO buildz_api WITH CHECK(requested_by=app.actor_id() AND app.is_project_member(project_id) AND state='pending');
CREATE POLICY mentorship_update ON app.mentorships FOR UPDATE TO buildz_api USING(mentor_id=app.actor_id() OR app.is_project_owner(project_id) OR requested_by=app.actor_id());
-- Only the request's project title and mentor display name are shared with the
-- recipient. No access to private summaries, files, progress or membership.
CREATE FUNCTION app.mentorship_labels(request uuid) RETURNS TABLE(mentor_display_name text,project_title text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p.display_name,j.title FROM app.mentorships m JOIN app.profiles p ON p.id=m.mentor_id JOIN app.projects j ON j.id=m.project_id
 WHERE m.id=request AND (m.mentor_id=app.actor_id() OR app.is_project_member(m.project_id)) $$;
CREATE FUNCTION app.notify_mentorship(request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m app.mentorships; BEGIN
 SELECT * INTO m FROM app.mentorships WHERE id=request;
 IF m.id IS NULL OR NOT (m.mentor_id=app.actor_id() OR app.is_project_member(m.project_id)) THEN RETURN; END IF;
 INSERT INTO app.notifications(recipient_id,type,subject_id)
 SELECT person,'mentorship.'||m.state,m.id FROM (SELECT m.mentor_id AS person UNION SELECT m.requested_by) x WHERE person<>app.actor_id();
END $$;
GRANT EXECUTE ON FUNCTION app.mentor_eligible(uuid,uuid),app.mentor_directory(uuid),app.accepted_mentor(uuid,uuid),app.mentorship_labels(uuid),app.notify_mentorship(uuid) TO buildz_api;
DROP POLICY consultations_insert ON app.consultations;
CREATE POLICY consultations_insert ON app.consultations FOR INSERT TO buildz_api WITH CHECK(app.is_project_member(project_id) AND booked_by=app.actor_id()
 AND EXISTS(SELECT 1 FROM app.consultation_slots s WHERE s.id=slot_id AND app.accepted_mentor(project_id,s.host_id)));
