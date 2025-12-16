import express from "express";
import {
    createGroup,
    getMyGroups,
    addMemberToGroup,
    getGroupMembers,
    addExpense
} from "../../controllers/groupController.js";

import { getGroupBalances } from "../../controllers/balanceController.js";
import { getGroupSettlements } from "../../controllers/settlementController.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";

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
router.get("/:groupId/settlements", authMiddleware, getGroupSettlements);

/*  
Group Balance Management
*/
router.get(
    "/:groupId/balances",
    authMiddleware,
    getGroupBalances
);

export default router;
