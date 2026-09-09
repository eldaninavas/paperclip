import { Rocket, Zap } from "lucide-react";
import { cn } from "../lib/utils";

interface FrontDoorProps {
  onChoose: (path: "create" | "grow") => void;
}

export function FrontDoor({ onChoose }: FrontDoorProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-(--sz-60vh) px-8">
      <div className="text-center mb-10">
        <h2 className="text-2xl font-bold tracking-tight">
          Empieza en Foundation
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Crea el trabajo, asígnalo a agentes de IA y conserva la decisión final en manos humanas.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg w-full">
        <button
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border-2 border-border p-6",
            "hover:border-foreground hover:bg-accent/30 transition-all",
            "text-center group cursor-pointer",
          )}
          onClick={() => onChoose("create")}
        >
          <div className="rounded-full bg-muted/50 p-3 group-hover:bg-accent transition-colors">
            <Rocket className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Crear una organización</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Define su misión, crea el primer proyecto e incorpora agentes para ejecutarlo.
            </p>
          </div>
        </button>

        <button
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border-2 border-border p-6",
            "hover:border-foreground hover:bg-accent/30 transition-all",
            "text-center group cursor-pointer",
          )}
          onClick={() => onChoose("grow")}
        >
          <div className="rounded-full bg-muted/50 p-3 group-hover:bg-accent transition-colors">
            <Zap className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Incorporar agentes</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Conecta agentes de IA a un equipo existente bajo revisión humana.
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
