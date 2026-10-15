-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "aiPersonalize" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SequenceStepRun" ADD COLUMN     "aiPersonalized" BOOLEAN NOT NULL DEFAULT false;
