export type WerkstattParamMapping =
  | "unipolar"
  | "linear"
  | "exp"
  | "int"
  | "bool";

export type WerkstattParamDeclaration = {
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  mapping: WerkstattParamMapping;
  unit: string;
};

export type WerkstattDeclarationSection = {
  group: { label: string; color: string } | null;
  params: WerkstattParamDeclaration[];
  samples: string[];
};

export type WerkstattDeclarations = {
  label: string | null;
  params: WerkstattParamDeclaration[];
  samples: string[];
  sections: WerkstattDeclarationSection[];
};

export async function parseWerkstattDeclarations(
  source: string
): Promise<WerkstattDeclarations> {
  const { ScriptDeclaration } = await import("@opendaw/studio-adapters");
  const params = [...ScriptDeclaration.parseParams(source)];
  const labels = params.map(({ label }) => label);
  const samples = ScriptDeclaration.parseSamples(source).map(
    ({ label }) => label
  );
  const allLabels = [...labels, ...samples];
  const duplicate = allLabels.find(
    (label, index) => allLabels.indexOf(label) !== index
  );
  if (duplicate) {
    throw new Error(`Duplicate Werkstatt declaration: ${duplicate}`);
  }

  return {
    label: ScriptDeclaration.parseLabel(source).unwrapOrNull(),
    params,
    samples,
    sections: ScriptDeclaration.parseGroups(source).map((section) => ({
      group: section.group,
      params: section.items.flatMap((item) =>
        item.type === "param" ? [item.declaration] : []
      ),
      samples: section.items.flatMap((item) =>
        item.type === "sample" ? [item.declaration.label] : []
      ),
    })),
  };
}

export function reconcileWerkstattParameters(
  declarations: readonly WerkstattParamDeclaration[],
  previous: Readonly<Record<string, number>>,
  reset = false
): Record<string, number> {
  return Object.fromEntries(
    declarations.map((declaration) => {
      const previousValue = previous[declaration.label];
      const value =
        reset || previousValue === undefined
          ? declaration.defaultValue
          : previousValue;
      const clamped = Math.max(
        declaration.min,
        Math.min(declaration.max, value)
      );
      let normalized = clamped;
      if (declaration.mapping === "bool") {
        normalized = Number(clamped >= 0.5);
      } else if (declaration.mapping === "int") {
        normalized = Math.round(clamped);
      }
      return [declaration.label, normalized];
    })
  );
}
