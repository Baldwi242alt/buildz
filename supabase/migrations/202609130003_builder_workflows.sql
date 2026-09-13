-- M2-M6: private workflows, explicit public projections, scheduling and credits.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE FUNCTION app.has_school_role(school uuid, requested text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM app.role_assignments r WHERE r.institution_id=school
  AND r.user_id=app.actor_id() AND r.revoked_at IS NULL AND r.role IN ('institution_admin',requested)) $$;
CREATE FUNCTION app.reviews_project(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM app.projects p WHERE p.id=project AND app.has_school_role(p.lead_institution_id,'reviewer')) $$;
CREATE FUNCTION app.verified_at(person uuid,school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM app.institution_memberships m WHERE m.user_id=person
  AND m.institution_id=school AND m.status='verified' AND (m.valid_until IS NULL OR m.valid_until>now())) $$;

CREATE TABLE app.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES app.projects(id),
  author_id uuid NOT NULL REFERENCES app.profiles(id), objectives text NOT NULL, support_requested text NOT NULL,
  minutes_requested integer NOT NULL CHECK(minutes_requested BETWEEN 0 AND 100000),
  state text NOT NULL DEFAULT 'submitted' CHECK(state IN ('submitted','approved','changes_requested','rejected')),
  decision_reason text, decided_by uuid REFERENCES app.profiles(id), supervisor_id uuid REFERENCES app.profiles(id),
  minutes_granted integer NOT NULL DEFAULT 0 CHECK(minutes_granted BETWEEN 0 AND 100000),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX proposal_pending ON app.proposals(project_id) WHERE state='submitted';
CREATE TABLE app.progress_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES app.projects(id),
  author_id uuid NOT NULL REFERENCES app.profiles(id), summary text NOT NULL, minutes_spent integer NOT NULL CHECK(minutes_spent BETWEEN 0 AND 100000),
  evidence jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.progress_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), progress_id uuid NOT NULL REFERENCES app.progress_updates(id),
  project_id uuid NOT NULL REFERENCES app.projects(id), reviewer_id uuid NOT NULL REFERENCES app.profiles(id),
  feedback text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('acknowledged','needs_attention')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION app.supervises_project(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM app.proposals p WHERE p.project_id=project
  AND p.state='approved' AND p.supervisor_id=app.actor_id()) $$;
CREATE FUNCTION app.can_review_project(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT app.reviews_project(project) OR app.supervises_project(project) $$;
CREATE FUNCTION app.workflow_access(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT app.is_project_member(project) OR app.can_review_project(project) $$;

CREATE TABLE app.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES app.institutions(id),
  name text NOT NULL, description text NOT NULL, category text NOT NULL CHECK(category IN ('room','studio','equipment','workshop','other')),
  location text NOT NULL, latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), hourly_rate integer NOT NULL CHECK(hourly_rate BETWEEN 0 AND 10000000),
  external_hourly_rate integer NOT NULL CHECK(external_hourly_rate BETWEEN 0 AND 10000000),
  cross_school boolean NOT NULL DEFAULT false, requires_approval boolean NOT NULL DEFAULT false,
  safety_code text, capacity integer NOT NULL DEFAULT 1 CHECK(capacity BETWEEN 1 AND 1000), active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.resource_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_id uuid NOT NULL REFERENCES app.resources(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CHECK(ends_at>starts_at),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_windows_lookup ON app.resource_windows(resource_id,starts_at,ends_at);
CREATE TABLE app.safety_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES app.institutions(id),
  user_id uuid NOT NULL REFERENCES app.profiles(id), safety_code text NOT NULL, verified_by uuid NOT NULL REFERENCES app.profiles(id),
  valid_until timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.profiles(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CHECK(ends_at>starts_at),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX availability_person ON app.availability(user_id,starts_at,ends_at);
CREATE FUNCTION app.shares_project(person uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM app.project_memberships a JOIN app.project_memberships b
  ON a.project_id=b.project_id WHERE a.user_id=app.actor_id() AND b.user_id=person) $$;
CREATE TABLE app.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES app.institutions(id),
  code text NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), discount_minor integer NOT NULL CHECK(discount_minor>0),
  budget_minor integer NOT NULL CHECK(budget_minor>0), max_redemptions integer NOT NULL CHECK(max_redemptions>0),
  valid_until timestamptz NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(institution_id,code)
);
CREATE TABLE app.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resource_id uuid NOT NULL REFERENCES app.resources(id),
  project_id uuid NOT NULL REFERENCES app.projects(id), booked_by uuid NOT NULL REFERENCES app.profiles(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, CHECK(ends_at>starts_at),
  state text NOT NULL CHECK(state IN ('pending','confirmed','cancelled','rejected','expired','completed','no_show')),
  attendees uuid[] NOT NULL CHECK(cardinality(attendees)>0), currency text NOT NULL, subtotal_minor integer NOT NULL CHECK(subtotal_minor>=0),
  discount_minor integer NOT NULL CHECK(discount_minor BETWEEN 0 AND subtotal_minor), total_minor integer NOT NULL CHECK(total_minor=subtotal_minor-discount_minor),
  voucher_id uuid REFERENCES app.vouchers(id), expires_at timestamptz, decision_reason text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(state IN ('pending','confirmed'))
);
CREATE INDEX bookings_project ON app.bookings(project_id,starts_at);
CREATE TABLE app.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), voucher_id uuid NOT NULL REFERENCES app.vouchers(id),
  booking_id uuid NOT NULL REFERENCES app.bookings(id), amount_minor integer NOT NULL,
  kind text NOT NULL CHECK(kind IN ('redeem','release')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(booking_id,kind),
  CHECK((kind='redeem' AND amount_minor>0) OR (kind='release' AND amount_minor<0))
);
CREATE TABLE app.consultation_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES app.institutions(id),
  host_id uuid NOT NULL REFERENCES app.profiles(id), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  location text NOT NULL, cross_school boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at>starts_at),
  EXCLUDE USING gist(host_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(active)
);
CREATE TABLE app.consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slot_id uuid NOT NULL REFERENCES app.consultation_slots(id),
  project_id uuid NOT NULL REFERENCES app.projects(id), booked_by uuid NOT NULL REFERENCES app.profiles(id),
  topic text NOT NULL, state text NOT NULL DEFAULT 'booked' CHECK(state IN ('booked','cancelled','completed')),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX consultation_slot_taken ON app.consultations(slot_id) WHERE state='booked';
CREATE TABLE app.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES app.projects(id),
  sender_id uuid NOT NULL REFERENCES app.profiles(id), body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL REFERENCES app.profiles(id),
  type text NOT NULL, subject_id uuid NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_inbox ON app.notifications(recipient_id,created_at DESC,id DESC);
-- Only deliberately authored public fields. No joins exposing private project data.
CREATE TABLE app.public_projects (
  id uuid PRIMARY KEY REFERENCES app.projects(id), title text NOT NULL, summary text NOT NULL, project_type text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}', seeking text NOT NULL DEFAULT '', published boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.collaboration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES app.projects(id),
  requester_id uuid NOT NULL REFERENCES app.profiles(id), message text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('advice','join')), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined','withdrawn')),
  response text, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX collaboration_pending ON app.collaboration_requests(project_id,requester_id) WHERE state='pending';
CREATE TABLE app.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES app.projects(id),
  reporter_id uuid NOT NULL REFERENCES app.profiles(id), reason text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dismissed','removed')), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION app.manages_resource(resource uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM app.resources r WHERE r.id=resource AND app.has_school_role(r.institution_id,'resource_manager')) $$;
CREATE FUNCTION app.resource_visible(resource uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=pg_catalog AS $$ SELECT EXISTS(SELECT 1 FROM app.resources r WHERE r.id=resource AND app.actor_id() IS NOT NULL
  AND (app.has_school_role(r.institution_id,'resource_manager') OR (r.active AND (r.cross_school OR app.verified_at(app.actor_id(),r.institution_id))))) $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['proposals','progress_updates','progress_reviews','resources','resource_windows','safety_credentials',
    'availability','vouchers','bookings','credit_ledger','consultation_slots','consultations','messages','notifications','public_projects','collaboration_requests','content_reports'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON app.%I TO buildz_api',t);
  END LOOP;
END $$;
GRANT DELETE ON app.availability,app.resource_windows TO buildz_api;
GRANT EXECUTE ON FUNCTION app.has_school_role(uuid,text),app.reviews_project(uuid),app.verified_at(uuid,uuid),app.supervises_project(uuid),
  app.can_review_project(uuid),app.workflow_access(uuid),app.shares_project(uuid),app.manages_resource(uuid),app.resource_visible(uuid) TO buildz_api;

CREATE POLICY proposal_read ON app.proposals FOR SELECT TO buildz_api USING(app.workflow_access(project_id));
CREATE POLICY proposal_insert ON app.proposals FOR INSERT TO buildz_api WITH CHECK(app.can_edit_project(project_id) AND author_id=app.actor_id() AND state='submitted');
CREATE POLICY proposal_update ON app.proposals FOR UPDATE TO buildz_api USING(app.reviews_project(project_id));
CREATE POLICY progress_read ON app.progress_updates FOR SELECT TO buildz_api USING(app.workflow_access(project_id));
CREATE POLICY progress_insert ON app.progress_updates FOR INSERT TO buildz_api WITH CHECK(app.is_project_member(project_id) AND author_id=app.actor_id());
CREATE POLICY review_read ON app.progress_reviews FOR SELECT TO buildz_api USING(app.workflow_access(project_id));
CREATE POLICY review_insert ON app.progress_reviews FOR INSERT TO buildz_api WITH CHECK(app.can_review_project(project_id) AND reviewer_id=app.actor_id());
CREATE POLICY resources_read ON app.resources FOR SELECT TO buildz_api USING(app.has_school_role(institution_id,'resource_manager') OR (app.actor_id() IS NOT NULL AND active AND (cross_school OR app.verified_at(app.actor_id(),institution_id))));
CREATE POLICY resources_insert ON app.resources FOR INSERT TO buildz_api WITH CHECK(app.has_school_role(institution_id,'resource_manager'));
CREATE POLICY resources_update ON app.resources FOR UPDATE TO buildz_api USING(app.has_school_role(institution_id,'resource_manager'));
CREATE POLICY windows_read ON app.resource_windows FOR SELECT TO buildz_api USING(app.resource_visible(resource_id));
CREATE POLICY windows_write ON app.resource_windows FOR ALL TO buildz_api USING(app.manages_resource(resource_id)) WITH CHECK(app.manages_resource(resource_id));
CREATE POLICY credentials_read ON app.safety_credentials FOR SELECT TO buildz_api USING(user_id=app.actor_id() OR app.has_school_role(institution_id,'resource_manager'));
CREATE POLICY credentials_write ON app.safety_credentials FOR ALL TO buildz_api USING(app.has_school_role(institution_id,'resource_manager')) WITH CHECK(app.has_school_role(institution_id,'resource_manager') AND verified_by=app.actor_id());
-- Teammates' full calendars are never directly readable, even with the runtime role.
CREATE POLICY availability_own ON app.availability FOR ALL TO buildz_api USING(user_id=app.actor_id()) WITH CHECK(user_id=app.actor_id());
CREATE POLICY vouchers_read ON app.vouchers FOR SELECT TO buildz_api USING(app.actor_id() IS NOT NULL);
CREATE POLICY vouchers_write ON app.vouchers FOR ALL TO buildz_api USING(app.has_school_role(institution_id,'resource_manager')) WITH CHECK(app.has_school_role(institution_id,'resource_manager'));
CREATE POLICY booking_read ON app.bookings FOR SELECT TO buildz_api USING(app.is_project_member(project_id) OR app.manages_resource(resource_id));
CREATE POLICY booking_insert ON app.bookings FOR INSERT TO buildz_api WITH CHECK(app.is_project_member(project_id) AND booked_by=app.actor_id());
CREATE POLICY booking_update ON app.bookings FOR UPDATE TO buildz_api USING(app.is_project_member(project_id) OR app.manages_resource(resource_id));
CREATE POLICY ledger_read ON app.credit_ledger FOR SELECT TO buildz_api USING(EXISTS(SELECT 1 FROM app.vouchers v WHERE v.id=voucher_id AND app.has_school_role(v.institution_id,'resource_manager')));
CREATE POLICY ledger_insert ON app.credit_ledger FOR INSERT TO buildz_api WITH CHECK(EXISTS(SELECT 1 FROM app.bookings b WHERE b.id=booking_id AND (app.is_project_member(b.project_id) OR app.manages_resource(b.resource_id))));
CREATE POLICY slots_read ON app.consultation_slots FOR SELECT TO buildz_api USING(app.actor_id() IS NOT NULL AND (cross_school OR app.verified_at(app.actor_id(),institution_id) OR app.has_school_role(institution_id,'reviewer')));
CREATE POLICY slots_write ON app.consultation_slots FOR ALL TO buildz_api USING(host_id=app.actor_id() AND app.has_school_role(institution_id,'reviewer')) WITH CHECK(host_id=app.actor_id() AND app.has_school_role(institution_id,'reviewer'));
CREATE POLICY consultations_read ON app.consultations FOR SELECT TO buildz_api USING(app.is_project_member(project_id) OR EXISTS(SELECT 1 FROM app.consultation_slots s WHERE s.id=slot_id AND s.host_id=app.actor_id()));
CREATE POLICY consultations_insert ON app.consultations FOR INSERT TO buildz_api WITH CHECK(app.is_project_member(project_id) AND booked_by=app.actor_id());
CREATE POLICY consultations_update ON app.consultations FOR UPDATE TO buildz_api USING(app.is_project_member(project_id) OR EXISTS(SELECT 1 FROM app.consultation_slots s WHERE s.id=slot_id AND s.host_id=app.actor_id()));
CREATE POLICY messages_read ON app.messages FOR SELECT TO buildz_api USING(app.is_project_member(project_id) OR app.supervises_project(project_id));
CREATE POLICY messages_insert ON app.messages FOR INSERT TO buildz_api WITH CHECK(sender_id=app.actor_id() AND (app.is_project_member(project_id) OR app.supervises_project(project_id)));
CREATE POLICY notifications_read ON app.notifications FOR SELECT TO buildz_api USING(recipient_id=app.actor_id());
CREATE POLICY notifications_update ON app.notifications FOR UPDATE TO buildz_api USING(recipient_id=app.actor_id()) WITH CHECK(recipient_id=app.actor_id());
CREATE POLICY public_read ON app.public_projects FOR SELECT TO buildz_api USING(published OR app.is_project_owner(id) OR app.reviews_project(id));
CREATE POLICY public_insert ON app.public_projects FOR INSERT TO buildz_api WITH CHECK(app.is_project_owner(id));
CREATE POLICY public_update ON app.public_projects FOR UPDATE TO buildz_api USING(app.is_project_owner(id) OR app.reviews_project(id));
CREATE POLICY collaboration_read ON app.collaboration_requests FOR SELECT TO buildz_api USING(requester_id=app.actor_id() OR app.is_project_owner(project_id));
CREATE POLICY collaboration_insert ON app.collaboration_requests FOR INSERT TO buildz_api WITH CHECK(requester_id=app.actor_id() AND EXISTS(SELECT 1 FROM app.public_projects p WHERE p.id=project_id AND p.published));
CREATE POLICY collaboration_update ON app.collaboration_requests FOR UPDATE TO buildz_api USING(requester_id=app.actor_id() OR app.is_project_owner(project_id));
CREATE POLICY report_read ON app.content_reports FOR SELECT TO buildz_api USING(reporter_id=app.actor_id() OR app.reviews_project(project_id));
CREATE POLICY report_insert ON app.content_reports FOR INSERT TO buildz_api WITH CHECK(reporter_id=app.actor_id() AND EXISTS(SELECT 1 FROM app.public_projects p WHERE p.id=project_id AND p.published));
CREATE POLICY report_update ON app.content_reports FOR UPDATE TO buildz_api USING(app.reviews_project(project_id));

-- Narrow read helpers expose availability/busy periods, never outsider identities or calendar notes.
CREATE FUNCTION app.team_windows(project uuid, people uuid[], from_time timestamptz, until_time timestamptz)
RETURNS TABLE(user_id uuid,starts_at timestamptz,ends_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a.user_id,a.starts_at,a.ends_at FROM app.availability a WHERE app.is_project_member(project)
 AND a.user_id=ANY(people) AND EXISTS(SELECT 1 FROM app.project_memberships m WHERE m.project_id=project AND m.user_id=a.user_id)
 AND a.starts_at<until_time AND a.ends_at>from_time $$;
CREATE FUNCTION app.resource_busy(resource uuid,from_time timestamptz,until_time timestamptz)
RETURNS TABLE(starts_at timestamptz,ends_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.starts_at,b.ends_at FROM app.bookings b WHERE b.resource_id=resource AND app.resource_visible(resource)
 AND b.state IN ('pending','confirmed') AND b.starts_at<until_time AND b.ends_at>from_time $$;
CREATE FUNCTION app.credential_valid(person uuid,school uuid,code text,until_time timestamptz,project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT app.is_project_member(project)
 AND EXISTS(SELECT 1 FROM app.project_memberships m WHERE m.project_id=project AND m.user_id=person)
 AND EXISTS(SELECT 1 FROM app.safety_credentials s WHERE s.user_id=person AND s.institution_id=school
 AND s.safety_code=code AND s.revoked_at IS NULL AND s.valid_until>=until_time) $$;
CREATE FUNCTION app.voucher_usage(voucher uuid) RETURNS TABLE(spent bigint,redemptions bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(sum(total.amount_minor),0)::bigint,count(DISTINCT total.booking_id) FILTER(WHERE total.net>0) FROM
 (SELECT l.booking_id,sum(l.amount_minor) AS amount_minor,sum(l.amount_minor) AS net FROM app.credit_ledger l
 WHERE l.voucher_id=voucher AND app.actor_id() IS NOT NULL GROUP BY l.booking_id) total $$;
GRANT EXECUTE ON FUNCTION app.team_windows(uuid,uuid[],timestamptz,timestamptz),app.resource_busy(uuid,timestamptz,timestamptz),
 app.credential_valid(uuid,uuid,text,timestamptz,uuid),app.voucher_usage(uuid) TO buildz_api;

-- Notifications are created through a bounded subject-aware function, not arbitrary inbox writes.
CREATE FUNCTION app.notify_project(project uuid,event_type text,subject uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT (app.workflow_access(project) OR EXISTS(SELECT 1 FROM app.bookings b WHERE b.id=subject AND b.project_id=project AND app.manages_resource(b.resource_id))
 OR EXISTS(SELECT 1 FROM app.consultations c JOIN app.consultation_slots s ON s.id=c.slot_id WHERE c.id=subject AND c.project_id=project AND s.host_id=app.actor_id())) THEN RETURN; END IF;
 INSERT INTO app.notifications(recipient_id,type,subject_id)
 SELECT user_id,event_type,subject FROM (
   SELECT user_id FROM app.project_memberships WHERE project_id=project
   UNION SELECT supervisor_id FROM app.proposals WHERE project_id=project AND state='approved' AND supervisor_id IS NOT NULL
 ) people WHERE user_id<>app.actor_id();
END $$;
GRANT EXECUTE ON FUNCTION app.notify_project(uuid,text,uuid) TO buildz_api;

CREATE FUNCTION app.valid_supervisor(project uuid,person uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.reviews_project(project) AND EXISTS(SELECT 1 FROM app.projects p JOIN app.institution_memberships m ON m.institution_id=p.lead_institution_id
 WHERE p.id=project AND m.user_id=person AND m.affiliation='staff' AND m.status='verified' AND (m.valid_until IS NULL OR m.valid_until>now())) $$;
GRANT EXECUTE ON FUNCTION app.valid_supervisor(uuid,uuid) TO buildz_api;

CREATE FUNCTION app.team_busy(project uuid,people uuid[],from_time timestamptz,until_time timestamptz)
RETURNS TABLE(user_id uuid,starts_at timestamptz,ends_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.user_id,b.starts_at,b.ends_at FROM app.project_memberships m JOIN app.bookings b ON m.user_id=ANY(b.attendees)
 WHERE m.project_id=project AND m.user_id=ANY(people) AND app.is_project_member(project)
 AND b.state IN ('pending','confirmed') AND b.starts_at<until_time AND b.ends_at>from_time
 UNION ALL SELECT m.user_id,s.starts_at,s.ends_at FROM app.project_memberships m
 JOIN app.consultations c ON c.booked_by=m.user_id JOIN app.consultation_slots s ON s.id=c.slot_id
 WHERE m.project_id=project AND m.user_id=ANY(people) AND app.is_project_member(project)
 AND c.state='booked' AND s.starts_at<until_time AND s.ends_at>from_time $$;
CREATE FUNCTION app.participant_eligibility(project uuid,resource uuid,people uuid[],until_time timestamptz)
RETURNS TABLE(user_id uuid,eligible boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.user_id, (EXISTS(SELECT 1 FROM app.institution_memberships s WHERE s.user_id=m.user_id AND s.status='verified'
 AND (s.valid_until IS NULL OR s.valid_until>=until_time) AND (r.cross_school OR s.institution_id=r.institution_id))
 AND (r.safety_code IS NULL OR EXISTS(SELECT 1 FROM app.safety_credentials c WHERE c.user_id=m.user_id
 AND c.institution_id=r.institution_id AND c.safety_code=r.safety_code AND c.revoked_at IS NULL AND c.valid_until>=until_time)))
 FROM app.project_memberships m CROSS JOIN app.resources r WHERE m.project_id=project AND m.user_id=ANY(people)
 AND r.id=resource AND app.is_project_member(project) $$;
GRANT EXECUTE ON FUNCTION app.team_busy(uuid,uuid[],timestamptz,timestamptz),app.participant_eligibility(uuid,uuid,uuid[],timestamptz) TO buildz_api;

CREATE FUNCTION app.booking_attendees_valid(booking uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.bookings b JOIN app.resources r ON r.id=b.resource_id WHERE b.id=booking AND app.manages_resource(r.id)
 AND r.active AND cardinality(b.attendees)<=r.capacity AND NOT EXISTS(SELECT 1 FROM unnest(b.attendees) person WHERE
 NOT EXISTS(SELECT 1 FROM app.project_memberships m WHERE m.project_id=b.project_id AND m.user_id=person)
 OR NOT EXISTS(SELECT 1 FROM app.institution_memberships m WHERE m.user_id=person AND m.status='verified' AND (m.valid_until IS NULL OR m.valid_until>=b.ends_at) AND (r.cross_school OR m.institution_id=r.institution_id))
 OR (r.safety_code IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.safety_credentials c WHERE c.user_id=person AND c.institution_id=r.institution_id AND c.safety_code=r.safety_code AND c.revoked_at IS NULL AND c.valid_until>=b.ends_at)))) $$;
GRANT EXECUTE ON FUNCTION app.booking_attendees_valid(uuid) TO buildz_api;

CREATE FUNCTION app.notify_collaboration(request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.collaboration_requests; owner uuid; BEGIN
 SELECT * INTO r FROM app.collaboration_requests WHERE id=request;
 SELECT owner_id INTO owner FROM app.projects WHERE id=r.project_id;
 IF app.actor_id() NOT IN (r.requester_id,owner) THEN RETURN; END IF;
 INSERT INTO app.notifications(recipient_id,type,subject_id)
 VALUES(CASE WHEN app.actor_id()=owner THEN r.requester_id ELSE owner END,'collaboration.'||r.state,r.id);
END $$;
CREATE FUNCTION app.consultation_slot_taken(slot uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.actor_id() IS NOT NULL AND EXISTS(SELECT 1 FROM app.consultations c WHERE c.slot_id=slot AND c.state='booked') $$;
CREATE FUNCTION app.notify_consultation_host(consultation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c app.consultations; host uuid; BEGIN
 SELECT * INTO c FROM app.consultations WHERE id=consultation;
 SELECT host_id INTO host FROM app.consultation_slots WHERE id=c.slot_id;
 IF NOT app.is_project_member(c.project_id) OR host=app.actor_id() THEN RETURN; END IF;
 INSERT INTO app.notifications(recipient_id,type,subject_id) VALUES(host,'consultation.'||c.state,c.id);
END $$;
CREATE FUNCTION app.project_is_active(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.projects WHERE id=project AND lifecycle<>'archived' AND app.workflow_access(project)) $$;
CREATE FUNCTION app.review_project_visible(project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.supervises_project(project) OR (app.reviews_project(project) AND EXISTS(SELECT 1 FROM app.proposals WHERE project_id=project)) $$;
CREATE POLICY project_review_read ON app.projects FOR SELECT TO buildz_api USING(app.review_project_visible(id));
CREATE FUNCTION app.school_staff(school uuid) RETURNS TABLE(user_id uuid,display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT p.id,p.display_name FROM app.profiles p JOIN app.institution_memberships m ON m.user_id=p.id
 WHERE m.institution_id=school AND m.affiliation='staff' AND m.status='verified' AND (m.valid_until IS NULL OR m.valid_until>now())
 AND (app.verified_at(app.actor_id(),school) OR app.has_school_role(school,'reviewer')) ORDER BY p.display_name,p.id LIMIT 100 $$;
GRANT EXECUTE ON FUNCTION app.notify_collaboration(uuid),app.consultation_slot_taken(uuid),app.notify_consultation_host(uuid),
 app.project_is_active(uuid),app.review_project_visible(uuid),app.school_staff(uuid) TO buildz_api;

-- Reservers need serialization, not resource/host editing privileges.
CREATE FUNCTION app.lock_resource(resource uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.resource_visible(resource) THEN RETURN false; END IF;
 PERFORM 1 FROM app.resources WHERE id=resource FOR UPDATE; RETURN FOUND;
END $$;
CREATE FUNCTION app.lock_consultation_slot(slot uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM app.consultation_slots s WHERE s.id=slot AND (s.cross_school OR app.verified_at(app.actor_id(),s.institution_id) OR s.host_id=app.actor_id()) FOR UPDATE;
 RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION app.lock_resource(uuid),app.lock_consultation_slot(uuid) TO buildz_api;
CREATE FUNCTION app.lock_voucher(voucher uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.actor_id() IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM app.vouchers WHERE id=voucher FOR UPDATE; RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION app.lock_voucher(uuid) TO buildz_api;

CREATE FUNCTION app.consultation_receipt(consultation uuid) RETURNS TABLE(starts_at timestamptz,ends_at timestamptz,location text,host_id uuid,host_display_name text,institution_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT s.starts_at,s.ends_at,s.location,s.host_id,p.display_name,s.institution_id
 FROM app.consultations c JOIN app.consultation_slots s ON s.id=c.slot_id JOIN app.profiles p ON p.id=s.host_id
 WHERE c.id=consultation AND (app.is_project_member(c.project_id) OR s.host_id=app.actor_id()) $$;
GRANT EXECUTE ON FUNCTION app.consultation_receipt(uuid) TO buildz_api;

CREATE FUNCTION app.expire_bookings() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b record; affected integer:=0; BEGIN
 FOR b IN SELECT id,resource_id FROM app.bookings WHERE state='pending' AND expires_at<=now() ORDER BY expires_at LIMIT 100 LOOP
   -- Same lock order as booking commands: resource, then booking, then voucher.
   PERFORM 1 FROM app.resources WHERE id=b.resource_id FOR UPDATE;
   UPDATE app.bookings SET state='expired',version=version+1 WHERE id=b.id AND state='pending' AND expires_at<=now();
   IF FOUND THEN
     PERFORM 1 FROM app.vouchers WHERE id=(SELECT voucher_id FROM app.bookings WHERE id=b.id) FOR UPDATE;
     INSERT INTO app.credit_ledger(voucher_id,booking_id,amount_minor,kind)
       SELECT voucher_id,id,-discount_minor,'release' FROM app.bookings WHERE id=b.id AND voucher_id IS NOT NULL AND discount_minor>0 ON CONFLICT DO NOTHING;
     INSERT INTO app.notifications(recipient_id,type,subject_id) SELECT booked_by,'booking.expired',id FROM app.bookings WHERE id=b.id;
     affected:=affected+1;
   END IF;
 END LOOP;
 RETURN affected;
END $$;
GRANT EXECUTE ON FUNCTION app.expire_bookings() TO buildz_worker;
