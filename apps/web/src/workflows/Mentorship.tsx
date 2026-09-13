import { useState } from "react";
import { api, unwrap, ServiceError, type Schemas } from "../lib/api";
import { ActionDialog } from "../components/ActionDialog";
import { Modal } from "../components/ui";
import { EmptyState, LoadState, StateLabel, useRemote } from "./common";
import { useWorkflowAction } from "./useWorkflowAction";

export function RequestMentorship({
  projectId,
  onChanged,
  disabled = false,
}: {
  projectId: string;
  onChanged?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <>
      <button
        className="button secondary"
        disabled={disabled}
        onClick={() => {
          setSent(false);
          setOpen(true);
        }}
      >
        Request for mentorship
      </button>
      {sent && (
        <p className="workflow-notice" role="status">
          Mentorship requested. Follow its status in Consultations. No session
          is booked until the mentor accepts and you choose a time.
        </p>
      )}
      {open && (
        <MentorshipRequest
          projectId={projectId}
          onClose={() => setOpen(false)}
          onSent={() => {
            setSent(true);
            onChanged?.();
            window.dispatchEvent(new Event("buildz:refresh"));
          }}
        />
      )}
    </>
  );
}
function MentorshipRequest({
  projectId,
  onClose,
  onSent,
}: {
  projectId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const data = useRemote(async (signal) => {
    try {
      const project = await unwrap(
        api!.GET("/v1/projects/{id}", {
          params: { path: { id: projectId } },
          signal,
        }),
      );
      const [mentors, requests] = await Promise.all([
        unwrap(
          api!.GET("/v1/mentors", {
            params: { query: { institutionId: project.leadInstitutionId } },
            signal,
          }),
        ),
        unwrap(
          api!.GET("/v1/projects/{id}/mentorships", {
            params: { path: { id: projectId } },
            signal,
          }),
        ),
      ]);
      return {
        project,
        mentors: mentors.filter(
          (mentor) =>
            !requests.some(
              (request) =>
                request.mentorId === mentor.userId &&
                ["pending", "accepted"].includes(request.state),
            ),
        ),
      };
    } catch (error) {
      if (
        error instanceof ServiceError &&
        ["NOT_FOUND", "FORBIDDEN", "CAPABILITY_DENIED"].includes(error.code)
      )
        throw new ServiceError(
          "Only accepted project members can request mentorship. Ask to join or request advice from the public showcase.",
          "MENTORSHIP_MEMBERSHIP_REQUIRED",
        );
      throw error;
    }
  }, projectId);
  if (data.error.includes("Only accepted project members"))
    return (
      <Modal title="Request for mentorship" onClose={onClose}>
        <p className="modal-intro">
          Only accepted project members can request mentorship. Ask to join or
          request advice from the public showcase.
        </p>
        <button className="button secondary" onClick={onClose}>
          Back to project
        </button>
      </Modal>
    );
  if (
    !data.data ||
    !data.data.mentors.length ||
    data.data.project.lifecycle === "archived"
  )
    return (
      <Modal title="Request for mentorship" onClose={onClose}>
        <p className="modal-intro">
          Accepted project members can ask a mentor from the project’s lead
          school for help, whether the project is private or public.
        </p>
        <LoadState
          loading={data.loading}
          error={data.error}
          retry={data.reload}
        />
        {data.data && (
          <EmptyState
            title={
              data.data.project.lifecycle === "archived"
                ? "This project is archived"
                : "No additional mentors available"
            }
          >
            Check your existing requests in Consultations, or ask your school to
            add eligible mentors.
          </EmptyState>
        )}
        <button className="button secondary" onClick={onClose}>
          Close
        </button>
      </Modal>
    );
  return (
    <ActionDialog
      onClose={onClose}
      action={{
        title: "Request for mentorship",
        label: "Send mentorship request",
        description: `Ask for guidance on ${data.data.project.title}. The mentor receives your project title and this message, not private project notes, files or member details. Acceptance enables consultation booking; it does not add the mentor to your team.`,
        fields: [
          {
            name: "mentorId",
            label: "Mentor",
            type: "select",
            options: data.data.mentors.map((mentor) => ({
              value: mentor.userId,
              label: mentor.displayName,
            })),
          },
          {
            name: "message",
            label: "What would you like mentorship with?",
            type: "textarea",
            maxLength: 2000,
            hint: "Share enough context to help the mentor decide. Leave out sensitive details.",
          },
        ],
        run: async (values, key) => {
          await unwrap(
            api!.POST("/v1/projects/{id}/mentorships", {
              params: {
                path: { id: projectId },
                header: { "Idempotency-Key": key },
              },
              body: {
                mentorId: values.mentorId,
                message: values.message.trim(),
              },
            }),
          );
          onSent();
        },
      }}
    />
  );
}

export function MentorshipInbox({
  requests,
  me,
  projects,
  reload,
}: {
  requests: Schemas["Mentorship"][];
  me: Schemas["Me"];
  projects: Schemas["Project"][];
  reload: () => void;
}) {
  const action = useWorkflowAction(reload);
  return (
    <section aria-label="Mentorship requests">
      <h3 className="section-subtitle">Your mentors & requests</h3>
      <p className="workflow-caption">
        A mentor must accept your project’s request before their sessions become
        bookable. Mentorship never grants access to private workspace content.
      </p>
      {action.notice}
      {!requests.length && (
        <EmptyState title="Find guidance for your next step">
          Open a project and choose “Request for mentorship”. Both private and
          public projects can ask for help.
        </EmptyState>
      )}
      {requests.map((item) => {
        const received = item.mentorId === me.id;
        const canCancel =
          received ||
          item.requestedBy === me.id ||
          projects.some(
            (project) =>
              project.id === item.projectId && project.ownerId === me.id,
          );
        const decisions: ("accepted" | "declined" | "cancelled")[] =
          received && item.state === "pending" ? ["accepted", "declined"] : [];
        if (canCancel && ["pending", "accepted"].includes(item.state))
          decisions.push("cancelled");
        return (
          <article className="workflow-record mentorship-record" key={item.id}>
            <StateLabel state={item.state} />
            <h3>{item.projectTitle}</h3>
            <p>
              {received
                ? "Request for you"
                : `Mentor: ${item.mentorDisplayName}`}
            </p>
            <p className="public-summary">{item.message}</p>
            <div className="record-actions">
              {decisions.map((decision) => {
                const label =
                  decision === "accepted"
                    ? "Accept mentorship"
                    : decision === "declined"
                      ? "Decline mentorship"
                      : "Cancel mentorship";
                return (
                  <button
                    key={decision}
                    className={`button ${decision === "accepted" ? "primary" : "secondary"}`}
                    onClick={() =>
                      action.open(
                        {
                          title: `${label}?`,
                          label,
                          description:
                            decision === "accepted"
                              ? "This project will be able to book your offered consultation sessions. No private workspace access is granted."
                              : "The project will not be able to book new sessions with this mentor. Cancel any upcoming consultations first; existing receipts are retained.",
                          fields: [],
                          versioned: true,
                          run: async (_values, key) => {
                            await unwrap(
                              api!.POST("/v1/mentorships/{id}/decisions", {
                                params: {
                                  path: { id: item.id },
                                  header: { "Idempotency-Key": key },
                                },
                                body: { version: item.version, decision },
                              }),
                            );
                          },
                        },
                        `Mentorship ${decision}.`,
                      )
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </article>
        );
      })}
      {action.dialog}
    </section>
  );
}
