export function ErrorMessageList({ children }: { children?: string[] }) {
  return (
    <div role="alert" className="text-red-500">
      {children}
    </div>
  );
}
