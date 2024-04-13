export function Card({ children }: React.PropsWithChildren) {
  return (
    <div className="border shadow-lg p-2 max-w-lg mx-auto rounded-lg">
      {children}
    </div>
  );
}
