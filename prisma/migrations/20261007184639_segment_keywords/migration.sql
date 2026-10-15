-- AlterTable
ALTER TABLE "Segment" ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[];
