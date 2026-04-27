import { forwardRef } from "react";

export const Reticle = forwardRef<HTMLDivElement>(function Reticle(_props, ref) {
  return (
    <div className="aim-overlay" aria-hidden="true" ref={ref} data-visible="false" data-lock="idle" data-lead-visible="false">
      <div className="reticle">
        <span />
        <span />
        <span />
        <span />
        <b />
      </div>
      <div className="lead-pip">
        <span />
      </div>
      <div className="mouse-aim">
        <span className="mouse-aim-ring" />
        <span className="mouse-aim-center" />
        <span className="mouse-aim-tick mouse-aim-tick-top" />
        <span className="mouse-aim-tick mouse-aim-tick-right" />
        <span className="mouse-aim-tick mouse-aim-tick-bottom" />
        <span className="mouse-aim-tick mouse-aim-tick-left" />
      </div>
    </div>
  );
});
