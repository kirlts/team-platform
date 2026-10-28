-- Third audit of the method (H-5): whether the attempt of the light model closed the work, as a stored fact. Before it was read from a note that only existed in the evidence of the judge,
-- so `scripts/light-limits.mjs` had nothing to take it from. 1 closed, 0 did not (it said so, ended blocked, ended `done` with nothing on its branch, or its delivery stayed red), NULL not known.
ALTER TABLE execute_judgments ADD COLUMN closed INTEGER;
