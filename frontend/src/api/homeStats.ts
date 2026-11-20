import { apiFetch } from "./client";

export type ApprovalStats = {
  average_days: number | null;
  approved_count: number;
  window_days: number;
};

export async function getApprovalStats(scope: "mine" | "all"): Promise<ApprovalStats> {
  const response = await apiFetch(`/home/approval-stats?scope=${scope}`);
  if (!response.ok) throw new Error("결재 통계를 불러오지 못했습니다");
  return response.json();
}
