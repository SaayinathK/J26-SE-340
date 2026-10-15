"""Interface for component-owned trainers; each component chooses its dependencies."""
from abc import ABC, abstractmethod

class BaseTrainer(ABC):
    @abstractmethod
    def train(self, data_directory, output_directory):
        """Train and return the saved artifact location."""
        raise NotImplementedError
