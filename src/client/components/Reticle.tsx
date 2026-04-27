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
        <span />
        <span />
      </div>
    </div>
  );
});
