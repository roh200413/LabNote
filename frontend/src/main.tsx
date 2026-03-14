import React from "react";
import ReactDOM from "react-dom/client";
import { MainLayout } from "./layout/MainLayout";
import { HomePage } from "./pages/HomePage";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MainLayout>
      <HomePage />
    </MainLayout>
  </React.StrictMode>
);
