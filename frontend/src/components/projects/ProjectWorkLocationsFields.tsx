import { useEffect, useRef } from 'react';
import { Button } from '../ui/ds';
import { RemoveIconButton } from '../ui/RemoveIconButton';
import './ProjectWorkLocationsFields.css';

export function ProjectWorkLocationsFields({
  id,
  location,
  additionalLocations,
  onChange
}: {
  id: string;
  location: string;
  additionalLocations: string[];
  onChange: (location: string, additionalLocations: string[]) => void;
}) {
  const additionalInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const previousLocationCount = useRef(additionalLocations.length);

  useEffect(() => {
    if (additionalLocations.length > previousLocationCount.current) {
      additionalInputRefs.current[additionalLocations.length - 1]?.focus();
    }
    previousLocationCount.current = additionalLocations.length;
  }, [additionalLocations.length]);

  return (
    <div className="field-group">
      <label htmlFor={id}>Local da obra</label>
      <input
        id={id}
        value={location}
        required
        onChange={(event) => onChange(event.target.value, additionalLocations)}
      />
      {additionalLocations.map((value, index) => (
        <div className="field-group" key={index}>
          <label htmlFor={`${id}-${index}`}>Local da obra {index + 2}</label>
          <div className="project-work-location-row">
            <input
              id={`${id}-${index}`}
              ref={(input) => {
                additionalInputRefs.current[index] = input;
              }}
              value={value}
              required
              onChange={(event) =>
                onChange(
                  location,
                  additionalLocations.map((item, i) =>
                    i === index ? event.target.value : item
                  )
                )
              }
            />
            <RemoveIconButton
              label={`Remover local da obra ${index + 2}`}
              onClick={() =>
                onChange(
                  location,
                  additionalLocations.filter((_, i) => i !== index)
                )
              }
            />
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange(location, [...additionalLocations, ''])}
      >
        Adicionar local da obra
      </Button>
    </div>
  );
}
