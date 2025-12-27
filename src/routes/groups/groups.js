import express from "express";
import {
    createGroup,
    getMyGroups,
    addMemberToGroup,
    getGroupMembers,
    addExpense,
    addMembersBulk,
    getGroupExpenses
} from "../../controllers/groupController.js";
import { settleUp } from "../../controllers/paymentController.js";
import { getGroupBalances } from "../../controllers/balanceController.js";
import { getGroupFinancialSummary } from "../../controllers/settlementController.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";
import { getGroupsSummary } from "../../controllers/groupController.js";
import { deleteGroup } from "../../controllers/groupController.js";
const router = express.Router();

/*
Group Creation and Retrieval
*/
router.post("/", authMiddleware, createGroup);
router.get("/", authMiddleware, getMyGroups);

/*
Group Member Management
*/
router.post("/:groupId/members", authMiddleware, addMemberToGroup);
router.get("/:groupId/members", authMiddleware, getGroupMembers);

/*
Group Expense Management
*/
router.post("/:groupId/expenses", authMiddleware, addExpense);

/*
Group Settlement Management
*/
router.get("/:groupId/financial-summary", authMiddleware, getGroupFinancialSummary);

/*  
Group Balance Management
*/
router.get(
    "/:groupId/balances",
    authMiddleware,
    getGroupBalances
);
/*
Group Member Management
*/
router.post("/:groupId/members/bulk", authMiddleware, addMembersBulk);

router.get("/:groupId/expenses", authMiddleware, getGroupExpenses);
/*
Group Summary
*/
router.get(
    "/summary",
    authMiddleware,
    getGroupsSummary
);

// POST /api/groups/:groupId/settle
router.post('/:groupId/settle', authMiddleware, settleUp);
router.delete("/:groupId", authMiddleware, deleteGroup);

export default router;
