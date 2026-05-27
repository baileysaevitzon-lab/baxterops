"use client";
import { Card, CardBody, CardHeader, PageHeader, Badge } from "@/components/Card";
import { COVARIATE_FIELDS, COMPOSITE_WEIGHTS, rubricFor } from "@/lib/covariateRubric";

export default function CovariateRubricPage() {
  return (
    <>
      <PageHeader
        title="Covariate Rubric"
        subtitle="Standardized scoring rubric for subjective field-tour variables. Bailey scores 1–5 (or yes/no) on every tour."
      />

      <Card className="mb-6">
        <CardHeader title="Composite Tour Experience Score — weighting" subtitle="Weighted average of subjective covariates. Editable later in /settings." />
        <CardBody>
          <table className="bx max-w-xl">
            <thead><tr><th>Covariate</th><th>Weight</th></tr></thead>
            <tbody>
              {Object.entries(COMPOSITE_WEIGHTS).map(([k, w]) => (
                <tr key={k}><td className="font-mono text-xs">{k}</td><td>{(w * 100).toFixed(0)}%</td></tr>
              ))}
              <tr><td className="font-medium">Total</td><td className="font-medium">{(Object.values(COMPOSITE_WEIGHTS).reduce((a,b)=>a+b,0) * 100).toFixed(0)}%</td></tr>
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`${COVARIATE_FIELDS.length} subjective covariates`} subtitle="Manual user entry only — never AI-inferred or scraped" />
        <CardBody className="p-0">
          <table className="bx">
            <thead>
              <tr><th>Key</th><th>Label</th><th>Type</th><th>Rubric / values</th></tr>
            </thead>
            <tbody>
              {COVARIATE_FIELDS.map(f => {
                const rubric = rubricFor(f.key);
                return (
                  <tr key={f.key}>
                    <td className="font-mono text-xs">{f.key}</td>
                    <td className="font-medium">{f.label}</td>
                    <td><Badge>{f.type}</Badge></td>
                    <td className="text-xs text-slate-700 max-w-xl">
                      {f.type === "rating_1_5" && rubric && (
                        <ul className="space-y-0.5">
                          {Object.entries(rubric).map(([k, v]) => <li key={k}><strong>{k}</strong> = {v}</li>)}
                        </ul>
                      )}
                      {f.type === "rating_1_5" && !rubric && <span className="italic text-slate-500">1 = worst · 5 = best</span>}
                      {f.type === "boolean" && <span>yes / no / unknown</span>}
                      {f.type === "enum" && <span>{f.enumValues?.join(" · ")}</span>}
                      {f.type === "number" && <span>{f.unit ?? ""}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
