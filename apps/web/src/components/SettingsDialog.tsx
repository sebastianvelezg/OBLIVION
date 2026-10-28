import { useState } from "react";
import type { SessionUser } from "@oblivion/sdk";
import { AccountPanel } from "./AccountPanel";
import { Modal, Segmented } from "./ui";
import { UsersPanel } from "./UsersPanel";

type Tab = "account" | "users";

export function SettingsDialog({ user, onClose }: { user: SessionUser; onClose: () => void }) {
  const isAdmin = user.role === "admin";
  const [tab, setTab] = useState<Tab>("account");

  return (
    <Modal title="Ajustes" onClose={onClose} wide={isAdmin && tab === "users"}>
      <div className="space-y-6">
        {isAdmin && (
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "account", label: "Mi cuenta" },
              { value: "users", label: "Usuarios" },
            ]}
          />
        )}
        {tab === "account" || !isAdmin ? <AccountPanel user={user} /> : <UsersPanel me={user} />}
      </div>
    </Modal>
  );
}
