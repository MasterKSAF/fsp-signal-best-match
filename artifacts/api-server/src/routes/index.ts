import { Router, type IRouter } from "express";
import healthRouter from "./health";
import signalAuthRouter from "./signal-auth";
import signalProfileAssessmentsRouter from "./signal-profile-assessments";
import signalEmployerMatchingRouter from "./signal-employer-matching";
import signalInvitationsRouter from "./signal-invitations";
import signalQualityRouter from "./signal-quality";
import signalResumeRouter from "./signal-resume";
import signalTrustRouter from "./signal-trust";
import signalFspRouter from "./signal-fsp";
import signalAssessmentContextRouter from "./signal-assessment-context";
import signalCandidateBankRouter from "./signal-candidate-bank";
import signalJobsRouter from "./signal-jobs";
import signalMicrotasksRouter from "./signal-microtasks";
import signalResearchRouter from "./signal-research";
import signalCandidateEvidenceRouter from "./signal-candidate-evidence";
import signalDictionariesRouter from "./signal-dictionaries";

const router: IRouter = Router();

router.use(healthRouter);
router.use(signalAuthRouter);
router.use(signalProfileAssessmentsRouter);
router.use(signalEmployerMatchingRouter);
router.use(signalInvitationsRouter);
router.use(signalQualityRouter);
router.use(signalResumeRouter);
router.use(signalTrustRouter);
router.use(signalFspRouter);
router.use(signalAssessmentContextRouter);
router.use(signalCandidateBankRouter);
router.use(signalJobsRouter);
router.use(signalMicrotasksRouter);
router.use(signalResearchRouter);
router.use(signalCandidateEvidenceRouter);
router.use(signalDictionariesRouter);

export default router;
