
const SuccessAnimation = () => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="w-24 h-24">
      <style>
        {`
            @keyframes circleFill {
              0% { transform: scale(0); }
              100% { transform: scale(1); }
            }
            
            @keyframes checkDraw {
              0% { stroke-dashoffset: 50; }
              100% { stroke-dashoffset: 0; }
            }
            
            .success-circle {
              fill: white;
              transform-origin: center;
              animation: circleFill 0.5s ease-out forwards;
            }
            
            .success-check {
              fill: none;
              stroke: black;
              stroke-width: 6;
              stroke-linecap: round;
              stroke-linejoin: round;
              stroke-dasharray: 50;
              stroke-dashoffset: 50;
              animation: checkDraw 0.5s ease-out 0.3s forwards;
            }
          `}
      </style>

      {/* Circle background */}
      <circle className="success-circle" cx="50" cy="50" r="40" />

      {/* Checkmark */}
      <path className="success-check" d="M35,50 L45,60 L65,40" />
    </svg>
  );
};

export default SuccessAnimation;