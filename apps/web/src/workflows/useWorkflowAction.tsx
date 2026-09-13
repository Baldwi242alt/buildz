import { useState } from "react";
import { ActionDialog, type ActionSpec } from "../components/ActionDialog";

export function useWorkflowAction(refresh: () => void) {
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [notice, setNotice] = useState("");
  function open(spec: ActionSpec, success: string) {
    setNotice("");
    setAction({
      ...spec,
      refresh: async () => {
        await spec.refresh?.();
        refresh();
      },
      run: async (values, key) => {
        await spec.run(values, key);
        setNotice(success);
        refresh();
      },
    });
  }
  return {
    open,
    action,
    notice: notice ? (
      <p className="workflow-notice" role="status">
        {notice}
      </p>
    ) : null,
    dialog: action ? (
      <ActionDialog action={action} onClose={() => setAction(null)} />
    ) : null,
  };
}
