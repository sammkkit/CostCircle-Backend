import express from "express";
import {
    createGroup,
    getMyGroups,
    addMemberToGroup,
    getGroupMembers
} from "../../controllers/groupController.js";
import { authMiddleware } from "../../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", authMiddleware, createGroup);
router.get("/", authMiddleware, getMyGroups);

router.post("/:groupId/members", authMiddleware, addMemberToGroup);
router.get("/:groupId/members", authMiddleware, getGroupMembers);

export default router;
