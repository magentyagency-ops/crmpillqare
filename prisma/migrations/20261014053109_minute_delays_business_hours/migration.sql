-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdByAssistant" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "delayMinutes" INTEGER NOT NULL DEFAULT 0;
