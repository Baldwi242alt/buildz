-- An ordinary member may leave without needing UPDATE privileges on a project.
CREATE FUNCTION app.leave_project(project uuid, expected_version integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
  SET search_path=pg_catalog AS $$
DECLARE owner uuid; revision integer; BEGIN
  SELECT owner_id,version INTO owner,revision FROM app.projects WHERE id=project FOR UPDATE;
  IF NOT FOUND OR owner=app.actor_id() OR revision<>expected_version THEN RETURN false; END IF;
  DELETE FROM app.project_memberships WHERE project_id=project AND user_id=app.actor_id();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE app.project_invitations SET state='revoked' WHERE project_id=project AND recipient_email=app.actor_email() AND state='pending';
  UPDATE app.projects SET version=version+1,updated_at=now() WHERE id=project;
  INSERT INTO app.audit_events(actor_id,action,subject_id) VALUES(app.actor_id(),'project.member_left',project);
  INSERT INTO app.outbox_events(actor_id,type,aggregate_id) VALUES(app.actor_id(),'project.member_changed',project);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.leave_project(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.leave_project(uuid,integer) TO buildz_api;
