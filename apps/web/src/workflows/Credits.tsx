import { useState } from "react";
import { Ticket, Plus } from "lucide-react";
import { api, unwrap, ServiceError, type Schemas } from "../lib/api";
import {
  dateTime,
  deviceTimezone,
  EmptyState,
  integer,
  isoDate,
  LoadState,
  money,
  SectionHeading,
  StateLabel,
  useRemote,
} from "./common";
import { PageControls } from "./Support";
import { manages } from "./Resources";
import { useWorkflowAction } from "./useWorkflowAction";

export function Credits({
  me,
  institutions,
}: {
  me: Schemas["Me"];
  institutions: Schemas["Institution"][];
}) {
  const [cursor, setCursor] = useState<string>();
  const [school, setSchool] = useState("");
  const [ledger, setLedger] = useState<Schemas["Voucher"] | null>(null);
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/vouchers", {
      params: {
        query: {
          limit: 100,
          cursor,
          ...(school ? { institutionId: school } : {}),
        },
      },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${me.id}:${school}:${cursor}`);
  const action = useWorkflowAction(data.reload);
  const eligible = institutions.filter((item) => manages(me, item.id));
  return (
    <>
      <SectionHeading
        eyebrow="A LITTLE HELP WITH THE COST"
        title="Campus vouchers"
        action={
          eligible.length > 0 && (
            <button
              className="button primary"
              onClick={() =>
                action.open(
                  {
                    title: "Create a campus voucher",
                    description:
                      "This is an institution-funded booking discount, not a cash payment. Enter money in the selected currency’s minor units. Review the budget and redemption limit before publishing the code.",
                    label: "Create voucher",
                    fields: [
                      {
                        name: "institutionId",
                        label: "Funding institution",
                        type: "select",
                        options: eligible.map((item) => ({
                          value: item.id,
                          label: item.name,
                        })),
                      },
                      {
                        name: "code",
                        label: "Voucher code",
                        maxLength: 64,
                        hint: "3–64 uppercase letters, numbers, underscores or hyphens.",
                      },
                      {
                        name: "currency",
                        label: "Currency",
                        type: "select",
                        options: [
                          ...new Set(institutions.map((item) => item.currency)),
                        ].map((value) => ({ value, label: value })),
                      },
                      {
                        name: "discountMinor",
                        label: "Discount per booking (minor units)",
                        type: "number",
                        min: 1,
                        max: 10000000,
                        hint: "SGD 100 = S$1.00. Discount is capped at the booking cost.",
                      },
                      {
                        name: "budgetMinor",
                        label: "Total funded budget (minor units)",
                        type: "number",
                        min: 1,
                        max: 10000000,
                      },
                      {
                        name: "maxRedemptions",
                        label: "Maximum active redemptions",
                        type: "number",
                        min: 1,
                        max: 10000000,
                      },
                      {
                        name: "validUntil",
                        label: "Expiry",
                        type: "datetime-local",
                        hint: `Input timezone: ${deviceTimezone}.`,
                      },
                      {
                        name: "confirm",
                        label:
                          "I have authority to allocate this institution’s voucher budget",
                        type: "checkbox",
                      },
                    ],
                    run: async (values, key) => {
                      const code = values.code.trim().toUpperCase();
                      if (!/^[A-Z0-9_-]{3,64}$/.test(code))
                        throw new ServiceError(
                          "Use 3–64 uppercase letters, numbers, underscores or hyphens for the code.",
                          "VALIDATION_ERROR",
                        );
                      await unwrap(
                        api!.POST("/v1/vouchers", {
                          params: { header: { "Idempotency-Key": key } },
                          body: {
                            institutionId: values.institutionId,
                            code,
                            currency: values.currency,
                            discountMinor: integer(
                              values.discountMinor,
                              "Discount",
                              1,
                              10000000,
                            ),
                            budgetMinor: integer(
                              values.budgetMinor,
                              "Budget",
                              1,
                              10000000,
                            ),
                            maxRedemptions: integer(
                              values.maxRedemptions,
                              "Redemption limit",
                              1,
                              10000000,
                            ),
                            validUntil: isoDate(values.validUntil, "expiry"),
                          },
                        }),
                      );
                    },
                  },
                  "Voucher created. Its actual usage is tracked by the booking ledger.",
                )
              }
            >
              <Plus size={17} />
              Create voucher
            </button>
          )
        }
      >
        Apply a valid code when reviewing your booking. Availability and
        remaining budget are checked at confirmation.
      </SectionHeading>
      <div className="workflow-toolbar">
        <label>
          Institution
          <select
            value={school}
            onChange={(event) => {
              setSchool(event.target.value);
              setCursor(undefined);
              setLedger(null);
            }}
          >
            <option value="">All institutions</option>
            {institutions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {action.notice}
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          {!data.data.items.length && (
            <EmptyState title="No active vouchers here">
              Your institution can publish codes to help cover eligible resource
              bookings.
            </EmptyState>
          )}
          <div className="voucher-grid">
            {data.data.items.map((item) => (
              <article className="voucher" key={item.id}>
                <Ticket size={26} />
                <span className="eyebrow">
                  {institutions.find(
                    (school) => school.id === item.institutionId,
                  )?.name || "Institution voucher"}
                </span>
                <h3>{money(item.discountMinor, item.currency)} off</h3>
                <label>
                  Voucher code
                  <input
                    readOnly
                    value={item.code}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <p>Valid until {dateTime(item.validUntil, me.timezone)}</p>
                <p className="workflow-caption">
                  For eligible resources at the funding institution. Discount
                  cannot exceed the booking cost.
                </p>
                {manages(me, item.institutionId) && (
                  <div className="record-actions">
                    <button
                      className="button secondary"
                      onClick={() =>
                        setLedger(ledger?.id === item.id ? null : item)
                      }
                    >
                      {ledger?.id === item.id
                        ? "Hide ledger"
                        : "View credit ledger"}
                    </button>
                    <button
                      className="button secondary"
                      onClick={() =>
                        action.open(
                          {
                            title: "Deactivate this voucher?",
                            description:
                              "New bookings will no longer be able to redeem this code. Saved booking discounts and ledger entries are retained.",
                            label: "Deactivate voucher",
                            fields: [],
                            run: async (_values, key) => {
                              await unwrap(
                                api!.POST("/v1/vouchers/{id}/deactivate", {
                                  params: {
                                    path: { id: item.id },
                                    header: { "Idempotency-Key": key },
                                  },
                                }),
                              );
                              setLedger(null);
                            },
                          },
                          "Voucher deactivated for new bookings.",
                        )
                      }
                    >
                      Deactivate
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          <PageControls
            next={data.data.next}
            cursor={cursor}
            setCursor={setCursor}
          />
        </>
      )}
      {ledger && <Ledger key={ledger.id} voucher={ledger} me={me} />}
      <p className="workflow-notice">
        Cancelling or rejecting an eligible reservation releases its voucher
        credit on the server. BuildZ does not process cash refunds or card
        payments.
      </p>
      {action.dialog}
    </>
  );
}
function Ledger({
  voucher,
  me,
}: {
  voucher: Schemas["Voucher"];
  me: Schemas["Me"];
}) {
  const [cursor, setCursor] = useState<string>();
  const data = useRemote(async (signal) => {
    const result = await api!.GET("/v1/vouchers/{id}/ledger", {
      params: { path: { id: voucher.id }, query: { limit: 100, cursor } },
      signal,
    });
    return {
      items: await unwrap(Promise.resolve(result)),
      next: result.data?.meta.nextCursor,
    };
  }, `${voucher.id}:${cursor}`);
  return (
    <section>
      <SectionHeading title={`Credit ledger · ${voucher.code}`}>
        Funded budget {money(voucher.budgetMinor, voucher.currency)} · maximum{" "}
        {voucher.maxRedemptions} active redemptions. Entries below are
        authoritative transactions, not an estimated balance.
      </SectionHeading>
      <LoadState
        loading={data.loading && !data.data}
        error={data.error}
        retry={data.reload}
      />
      {data.data && (
        <>
          {!data.data.items.length && (
            <p className="workflow-caption">
              No redemptions or releases recorded yet.
            </p>
          )}
          {data.data.items.map((item) => (
            <article className="workflow-record ledger-entry" key={item.id}>
              <div>
                <StateLabel state={item.kind} />
                <p>{dateTime(item.createdAt, me.timezone)}</p>
                <span className="workflow-caption">
                  Booking {item.bookingId}
                </span>
              </div>
              <strong>{money(item.amountMinor, voucher.currency)}</strong>
            </article>
          ))}
          <PageControls
            next={data.data.next}
            cursor={cursor}
            setCursor={setCursor}
          />
        </>
      )}
    </section>
  );
}
