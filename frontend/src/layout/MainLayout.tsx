import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function MainLayout({ children }: Props) {
  return (
    <main className="app-shell">
      <header>
        <h1>LabNote</h1>
      </header>
      {children}
    </main>
  );
}
