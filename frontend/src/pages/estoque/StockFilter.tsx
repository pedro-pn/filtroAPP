import { SearchCombobox, type SearchComboboxOption } from '../../components/ui/SearchCombobox';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchComboboxOption[];
  placeholder?: string;
}

export function StockFilter({ label, placeholder = 'Digite para pesquisar', ...props }: Props) {
  return <SearchCombobox {...props} label={label} placeholder={placeholder} hideLabel variant="select" portal clearOnFocus />;
}
