# School Segregation Boundaries
## Attendance Zone Racial Discontinuity · Chicago Public Schools

**Live Demo:** https://kalchikee.github.io/school-segregation-boundaries/

---

### Overview

School district attendance boundaries determine which school a child attends. In Chicago, many of these boundaries run along the Dan Ryan Expressway, the Eisenhower Expressway, and railroad corridors — infrastructure that was deliberately routed through Black neighborhoods in the 1950s and 60s. A line running along a highway can mean children 500 meters apart attend schools with radically different demographics, funding, and performance.

### The Boundary Segregation Index (BSI)

A composite score (0–100) for every shared attendance zone boundary:
- **40%** — Racial composition discontinuity (% non-white difference between adjacent schools)
- **30%** — Economic discontinuity (% low-income difference)
- **30%** — Attendance gap (scaled; attendance is the most consistently-reported per-school engagement metric in the current CPS Progress Report feed)

The demo loads **356 real CPS elementary attendance zones** from the City of Chicago Data Portal (SY2425) with demographics from the School Profile Information feed. Shared boundaries between adjacent zones (931 pairs) are derived directly from the polygon geometry. See `notebooks/build_real_dataset.py` for the pipeline.

### Key Findings

- Boundaries following the Dan Ryan Expressway corridor show BSI scores averaging **82** — among the highest in the city
- School pairs on either side of the Eisenhower Expressway show an average **44 percentage point** racial composition gap
- Boundaries that follow highways or rail lines have a median BSI **34 points higher** than boundaries through residential areas
- Per-pupil expenditure gaps between high-BSI boundary pairs average **$2,300/year**

### Data Sources

| Dataset | Source |
|---------|--------|
| Attendance zone boundaries | NCES SABINS (School Attendance Boundary Information System) |
| School demographics | NCES Common Core of Data (CCD) |
| School performance | Illinois State Board of Education Report Card |
| Census block demographics | Census 2020 PL 94-171 |
| Per-pupil expenditure | NCES EDGE Finance Data |
| Highway/railroad lines | OpenStreetMap |
| HOLC Redlining maps | Mapping Inequality Project |
