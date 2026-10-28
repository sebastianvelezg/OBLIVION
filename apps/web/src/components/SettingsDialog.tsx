import { useState } from "react";
import type { SessionUser } from "@oblivion/sdk";
import { AccountPanel } from "./AccountPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { Modal, Segmented } from "./ui";
import { UsersPanel } from "./UsersPanel";

type Tab = "account" | "connections" | "users";

export function SettingsDialog({ user, onClose }: { user: SessionUser; onClose: () => void }) {
  const isAdmin = user.role === "admin";
  const [tab, setTab] = useState<Tab>("account");

  return (
    <Modal title="Ajustes" onClose={onClose} wide={isAdmin && tab !== "account"}>
      <div className="space-y-6">
        {isAdmin && (
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "account", label: "Mi cuenta" },
              { value: "connections", label: "Conexiones" },
              { value: "users", label: "Usuarios" },
            ]}
          />
        )}
        {tab === "account" || !isAdmin ? (
          <AccountPanel user={user} />
        ) : tab === "connections" ? (
          <ConnectionsPanel />
        ) : (
          <UsersPanel me={user} />
        )}
      </div>
    </Modal>
  );
}
