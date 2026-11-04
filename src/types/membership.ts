/** Shared account/Music BFF contract. All timestamps are server-generated ISO UTC. */
export type OtpPurpose = "login" | "membership";
export type OtpRequest = {email: string};
export type OtpVerify = {challengeId: string; code: string};
export type OtpChallengeResponse = {challengeId: string; expiresAt: string; resendAfter: string; serverTime: string};
export type MembershipApplicationStatus = "queued" | "offered" | "redeemed" | "expired" | "cancelled" | "blocked";
export type MailDeliveryStatus = "pending" | "processing" | "sent" | "failed" | "cancelled";
export type MembershipApplicationView = {
  id: string; status: MembershipApplicationStatus; version: number; queuedAt: string;
  offeredAt: string | null; durationDays: number | null; redeemBy: string | null;
  queuePosition: number | null; deliveryStatus: MailDeliveryStatus | null; resendAfter: string | null;
};
export type MembershipStatusResponse = {
  serverTime: string; applicationsOpen: boolean; dispatchEnabled: boolean; emailLoginEnabled: boolean;
  emailVerifiedAt: string | null; canApply: boolean;
  reason: "already_member" | "applications_closed" | "email_verification_required" | "application_exists" | "application_blocked" | null;
  application: MembershipApplicationView | null;
};
export type MembershipPolicyChanges = {applicationsOpen?: boolean; dispatchEnabled?: boolean; emailLoginEnabled?: boolean};
export type MembershipDecision = {
  allowed: boolean; reason: "normal" | "hard_limit" | "soft_wait" | "spill_interval" | "release_expected" | "controlled_spill";
  durationDays: number; spill?: boolean; occupied: number; personDays: number; perApplicant: number; version: string;
};
export type MembershipPolicyView = {
  id: number; version: string; softThreshold: number; hardLimit: number; offerHours: number;
  spillWaitHours: number; spillIntervalHours: number; forecastHours: number;
  applicationsOpen: boolean; dispatchEnabled: boolean; emailLoginEnabled: boolean;
  lastSpillAt: string | null; lastDispatchAt: string | null; workerHeartbeatAt: string | null; updatedAt: string;
};
export type MembershipAdminState = {
  serverTime: string; policy: MembershipPolicyView;
  capacity: {active: number; permanent: number; reserved: number; occupied: number; hardLimit: number};
  queued: number; nextDecision: MembershipDecision | null; mail: {pending: number; failed: number};
};
export type MembershipAdminApplication = {
  id: string; status: MembershipApplicationStatus; queuedAt: string; offeredAt: string | null; durationDays: number | null; version: number;
  user: {id: string; email: string; nickname: string | null};
  inviteCode: {expiresAt: string | null; redeemedAt: string | null} | null;
};
export type MembershipAdminMail = {
  id: string; userId: string | null; applicationId: string | null; toAddress: string; kind: string; status: MailDeliveryStatus;
  attempts: number; nextAttemptAt: string; expiresAt: string; sentAt: string | null; lastErrorCode: string | null; createdAt: string;
};
export type MembershipAuditView = {
  id: string; actorUserId: string | null; userId: string | null; applicationId: string | null;
  event: string; details: Record<string, unknown>; createdAt: string;
};
