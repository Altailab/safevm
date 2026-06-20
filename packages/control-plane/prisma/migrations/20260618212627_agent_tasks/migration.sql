-- CreateEnum
CREATE TYPE "SessionDriver" AS ENUM ('human', 'agent', 'copilot');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('pending', 'running', 'awaiting_approval', 'succeeded', 'failed', 'stopped');

-- CreateEnum
CREATE TYPE "AgentActionType" AS ENUM ('screenshot', 'click', 'type', 'key', 'scroll', 'exec', 'wait', 'finish');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "driver" "SessionDriver" NOT NULL DEFAULT 'human';

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'pending',
    "model" TEXT NOT NULL DEFAULT 'mock',
    "maxSteps" INTEGER NOT NULL DEFAULT 20,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "thought" TEXT,
    "actionType" "AgentActionType" NOT NULL,
    "action" JSONB NOT NULL DEFAULT '{}',
    "observation" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentTask_tenantId_status_idx" ON "AgentTask"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AgentStep_taskId_idx_idx" ON "AgentStep"("taskId", "idx");

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
