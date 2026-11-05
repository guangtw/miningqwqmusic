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
  familiar?: FamiliarRecognitionView;
};
/** Legacy UI's three boolean switches; retained until the new admin UI is integrated. */
export type MembershipPolicyChanges = {applicationsOpen?: boolean; dispatchEnabled?: boolean; emailLoginEnabled?: boolean};
export type MembershipAdmissionPolicyChanges = MembershipPolicyChanges & {
  admissionMode?: "legacy" | "familiar-first"; familiarVerificationEnabled?: boolean; ordinaryDispatchEnabled?: boolean;
  ordinaryReservedNormalSlots?: number | null;
  familiarChallengeIpDailyLimit?: number; familiarChallengeGlobalDailyLimit?: number;
  familiarVerifyUserDailyLimit?: number; familiarVerifyIpHourlyLimit?: number; familiarVerifyGlobalDailyLimit?: number;
};
export type MembershipDecision = {
  allowed: boolean; reason: "normal" | "hard_limit" | "soft_wait" | "spill_interval" | "release_expected" | "controlled_spill";
  durationDays: number; spill?: boolean; occupied: number; personDays: number; perApplicant: number; version: string;
};
export type MembershipPolicyView = MembershipAdmissionPolicyChanges & {
  id: number; version: string; softThreshold: number; hardLimit: number; offerHours: number;
  spillWaitHours: number; spillIntervalHours: number; forecastHours: number;
  applicationsOpen: boolean; dispatchEnabled: boolean; emailLoginEnabled: boolean;
  lastSpillAt: string | null; lastDispatchAt: string | null; workerHeartbeatAt: string | null; updatedAt: string;
};
export type MembershipAdminState = {
  serverTime: string; policy: MembershipPolicyView;
  capacity: {active: number; permanent: number; reserved: number; occupied: number; hardLimit: number};
  queued: number; nextDecision: MembershipDecision | null; mail: {pending: number; failed: number};
  nextApplicationId?: string | null; nextLane?: AdmissionLane | null;
  queues?: {familiar: number; ordinary: number}; familiar?: {activeQuestions: number; activeRecognitions: number;
    warnings: ("insufficient_questions" | "small_question_bank")[]};
};
/** Use this contract when integrating familiar-first mode; the old UI stays in legacy mode. */
export type MembershipAdmissionDecision = Omit<MembershipDecision, "reason"> & {
  reason: MembershipDecision["reason"] | "ordinary_paused" | "reserve_unconfigured" | "protected_capacity";
};
export type MembershipAdmissionAdminState = Omit<MembershipAdminState, "nextDecision"> & {
  nextDecision: MembershipAdmissionDecision | null;
};
export type MembershipAdminApplication = {
  id: string; status: MembershipApplicationStatus; queuedAt: string; offeredAt: string | null; durationDays: number | null; version: number;
  offerLane?: AdmissionLane | null; offerEvidenceId?: string | null;
  user: {id: string; email: string; nickname: string | null; familiarRecognition?: {status: string; verifiedAt: string | null} | null};
  inviteCode: {expiresAt: string | null; redeemedAt: string | null} | null;
};

export type AdmissionLane = "legacy" | "familiar" | "ordinary";
export type FamiliarRecognitionView = {verified: boolean; verifiedAt: string | null};
export type FamiliarStatus = FamiliarRecognitionView & {
  serverTime: string; canVerify: boolean;
  reason: "verified" | "unavailable" | "email_verification_required" | null; nextChallengeAt: string | null;
  periodOptions?: FamiliarPeriodOption[];
};
export type FamiliarPeriodOption = {id: string; label: string};
export type FamiliarPeriodInput = {id?: string; label: string; sortOrder: number; enabled: boolean};
export type FamiliarPeriodView = FamiliarPeriodOption & {sortOrder: number; enabled: boolean; createdAt: string; updatedAt: string};
export type FamiliarAdminPeriod = FamiliarPeriodView & {targetedQuestions: number; generalQuestions: number; available: boolean};
export type FamiliarChallengeRequest = {periodId?: string | null};
export type FamiliarChallengeView = {
  challengeId: string; serverTime: string; expiresAt: string; nextChallengeAt: string;
  available: boolean; attemptsRemaining: number; questions: {slot: number; prompt: string}[];
  period?: FamiliarPeriodOption | null;
};
export type FamiliarVerifyRequest = {challengeId: string; answers: [string, string]};
export type FamiliarVerifyResult = {passed: false; serverTime: string; attemptsRemaining: number; nextChallengeAt: string} |
  ({passed: true} & FamiliarStatus);
export type FamiliarQuestionInput = {
  questionId?: string; title: string; group: string; prompt: string; notes?: string;
  status: "draft" | "active"; answers: string[];
  /** Empty = general-purpose; omitted on revision preserves its previous targeting. */
  periodIds?: string[];
};
export type FamiliarQuestionView = Omit<FamiliarQuestionInput, "answers" | "questionId" | "status"> & {
  id: string; questionId: string; version: number; status: "draft" | "active" | "retired" | "disabled";
  answerCount: number; normalizationVersion: number; createdAt: string;
};
export type FamiliarAdminAction = {userId: string; action: "grant" | "revoke" | "unblock"; reason: string};
export type FamiliarAdminRecognition = {
  userId: string; status: "active" | "revoked"; source: "manual" | "challenge";
  verifiedAt: string | null; revokedAt: string | null; selfServiceBlocked: boolean; evidenceId: string | null;
};
export type FamiliarAdminAccount = FamiliarAdminRecognition & {user: {id: string; email: string; nickname: string | null}};
export type FamiliarAdminEvidence = {
  id: string; userId: string; source: "manual" | "challenge"; challengeId: string | null; questionVersionIds: string[];
  actorUserId: string | null; reason: string | null; createdAt: string;
  periodId: string | null; periodLabel: string | null;
  matchedQuestions: Pick<FamiliarQuestionView, "id" | "questionId" | "version" | "title" | "prompt" | "status">[];
};
export type FamiliarAdminDetail = {
  user: {id: string; email: string; nickname: string | null}; recognition: FamiliarAdminRecognition | null;
  evidence: FamiliarAdminEvidence[];
  recentChallenges: {id: string; attempts: number; createdAt: string; expiresAt: string; consumedAt: string | null;
    invalidatedAt: string | null; lastAttemptAt: string | null; ipHash: string; periodId: string | null; periodLabel: string | null}[];
};
export type MembershipAdminMail = {
  id: string; userId: string | null; applicationId: string | null; toAddress: string; kind: string; status: MailDeliveryStatus;
  attempts: number; nextAttemptAt: string; expiresAt: string; sentAt: string | null; lastErrorCode: string | null; createdAt: string;
};
export type MembershipAuditView = {
  id: string; actorUserId: string | null; userId: string | null; applicationId: string | null;
  event: string; details: Record<string, unknown>; createdAt: string;
};
