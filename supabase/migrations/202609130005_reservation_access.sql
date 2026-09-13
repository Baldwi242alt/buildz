-- Existing reservations remain manageable when a facility changes visibility.
CREATE FUNCTION app.resource_related(resource uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.bookings b WHERE b.resource_id=resource AND app.is_project_member(b.project_id)) $$;
CREATE POLICY resources_existing_booking_read ON app.resources FOR SELECT TO buildz_api USING(app.resource_related(id));
CREATE OR REPLACE FUNCTION app.resource_visible(resource uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.resources r WHERE r.id=resource AND app.actor_id() IS NOT NULL
 AND (app.has_school_role(r.institution_id,'resource_manager') OR app.resource_related(resource)
 OR (r.active AND (r.cross_school OR app.verified_at(app.actor_id(),r.institution_id))))) $$;
CREATE FUNCTION app.consultation_related(slot uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.consultations c WHERE c.slot_id=slot AND app.is_project_member(c.project_id)) $$;
CREATE POLICY slots_existing_booking_read ON app.consultation_slots FOR SELECT TO buildz_api USING(app.consultation_related(id));
CREATE OR REPLACE FUNCTION app.lock_consultation_slot(slot uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM app.consultation_slots s WHERE s.id=slot AND (s.cross_school OR app.verified_at(app.actor_id(),s.institution_id)
 OR s.host_id=app.actor_id() OR app.consultation_related(slot)) FOR UPDATE;
 RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION app.resource_related(uuid),app.consultation_related(uuid) TO buildz_api;
